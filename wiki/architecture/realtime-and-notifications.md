---
title: Realtime & Notifications
tags: [architecture, realtime, mqtt, notification, worker]
updated: 2026-06-01
sources:
  - server/worker.js
  - server/workers/mqttNotifier.js
  - server/workers/notifier_logic.js
  - server/workers/webpushDispatcher.js
  - server/workers/lineDispatcher.js
  - server/workers/smartLineDispatcher.js
  - server/utils/smartEeNotify.js
  - client/src/contexts/MQTTContext.jsx
  - client/src/components/SetNotifyModal.jsx
  - client/src/index.css:90
  - server/index.js:1018
---

# Realtime & Notifications

มีข้อมูลเรียลไทม์ **สองสาย** ที่ไม่ปนกัน:

1. **หน้าจอ realtime/OEE** — อ่านจาก SQL Server ผ่าน REST.
2. **Live MQTT + การแจ้งเตือน** — worker แยกประมวลผล threshold แล้ว push.

## สาย 1: หน้า Realtime (REST จาก DB)

`GET /api/realtime?meters=<csv ids>` (`server/index.js:1018`):
- query `dbo.jobcurrent` หา machine + ชื่อ, แล้ว pivot `dbo.ColQuartery`
  (`n_column` 7/8/9/10 → OEE/P/A/Q) ด้วย `MAX(CASE WHEN ...)`.
- logic port มาจาก `Realtime.aspx.vb` (ระบบเดิมต่อ OPC/Modbus ผ่าน DLL; ฝั่ง Node อ่านจาก DB แทน).
- กัน SQL injection ของ `IN (...)` ด้วยการ `parseInt` ทุกค่าแล้ว `filter(!isNaN)` ก่อนต่อสตริง
  (`server/index.js:1029`) — ดูหมายเหตุใน [[gotchas]].

## สาย 2: MQTT → NotifyLog → Push

### Broker (`server/workers/mqttNotifier.js:80`)
- `MQTT_MODE` = `cloud` (default `wss://cloudtat.com:9001/mqtt`) หรือ `onsite`
  (`ws://localhost:9001/mqtt`). override ได้ทั้งจาก env (`MQTT_*`) และ JSON config.
- ฝั่ง client ก็ subscribe broker เดียวกันผ่าน `MQTTContext` เพื่อโชว์ค่าสด.

### Pure logic (`server/workers/notifier_logic.js`)
แยกออกมาเป็น **side-effect-free** เพื่อ unit test ได้โดยไม่ต้องมี broker/DB
(เทสต์: `server/workers/notifier_logic.test.js`, รันด้วย `npm test` ใน `server/`). หัวใจ:

- `enrichPayload(obj)` — เติม `VoltP-avr` / `Amp-avr` (ค่าเฉลี่ย 3 เฟส) ถ้า device ไม่ส่งมา;
  ถ้า device ส่งเองให้ device ชนะ; ต้องมีครบ 3 เฟสถึงคำนวณ.
- **Severity 2 ระดับ**: `Very High`/`Very Low` = 2 (extreme), `High`/`Low` = 1 (moderate).
- `pickTriggeredLevel(value, configs)` — เลือก level ที่ severe สุดที่ค่าทะลุ (ฝั่งบนเช็คก่อน).
- `decideAction(prev, value, configs, now)` — **state machine** คืน action อย่างใดอย่างหนึ่ง:
  `noop` / `startTimer` (เริ่ม debounce) / `fire` (`raise` หรือ `escalate`) /
  `updateLevel` (de-escalate เงียบ ๆ) / `startClearTimer` / `clear`.
  - มี **debounce delay** ก่อน fire และ **clear delay** ก่อนปิด alarm (ต่อ config).
  - escalate เมื่อ severity ใหม่ > peak เดิมเท่านั้น; de-escalation ไม่ log.
  - `clear` อ้าง `correlationId = raiseLogId` เพื่อจับคู่กับ event ที่ raise.

### Worker (`server/workers/mqttNotifier.js`)
- โหลด `NotifyConfig` (threshold ต่อ `mqtt_serial` + `dbkey` + `level`) มา cache.
- ทุกข้อความ MQTT → `extractFirstJsonObject` → `enrichPayload` → `decideAction` →
  ถ้า `fire`/`clear` ก็ **insert `NotifyLog`** (ดูคอลัมน์ใน [[schema-and-conventions]]).

### Dispatchers (อ่าน `NotifyLog` ที่ pending แล้วส่งออก)
- **webpushDispatcher** (`server/workers/webpushDispatcher.js`) — ส่ง Web Push ผ่าน VAPID.
  ต้องตั้ง `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; subject ถูก normalize ให้ขึ้นต้น
  `mailto:`/`https://` ไม่งั้น iOS/APNs ตอบ 403 (`server/worker.js:32`). subscription เก็บใน
  `UserNotificationSubscription`.
- **lineDispatcher** (`server/workers/lineDispatcher.js`) — เดิน cursor ต่อ subscription ส่งเข้า
  LINE Messaging API. ทำงานไม่ขึ้นกับ VAPID. (งานล่าสุดบน branch `module-Realtime.jsx` —
  commit `87c620f0 Update Line Notification`.) ดู `server/utils/lineApi.js`.
- **smartLineDispatcher** (`server/workers/smartLineDispatcher.js`) — channel `smart`
  ("Smart EE Notification"). โครงเหมือน lineDispatcher เป๊ะ (cursor/scope/batch/dead-sub)
  ต่างกันแค่ match `alarm_type` ด้วย token `smart` และ **ไม่ได้ยิง LINE Messaging API ตรง** —
  ส่งผ่าน relay ของ smarteepro.com (`server/utils/smartEeNotify.js`). ดูหัวข้อ "Channel `smart`".

### Channel `smart` — Smart EE LINE relay (ไม่ใช้ LINE Messaging API ตรง)
LINE bot ตัวนี้ **ไม่ได้คุย LINE Messaging API** แต่ยิงผ่าน relay กลางของ smarteepro.com ซึ่ง
**เป็นเจ้าของ binding `gid+pin → LINE group ไหน` เอง** ฝั่งเราจึงไม่ต้องรู้ `chatId`/Channel
Access Token เลย แค่ "ส่งต่อ" ข้อความ:

```
POST {SMARTEE_NOTIFY_URL}            (multipart/form-data)
  configure = "gid=<gid>&pin=<pin>&pas=<pas>"
  message   = "<text>"
  imageFile = <file>   (optional, ยังไม่ใช้)
```

| | `line` | `smart` |
|---|---|---|
| โมเดล | BYO-bot, คุย LINE Messaging API ตรง | relay ผ่าน smarteepro.com |
| ผู้ใช้กรอก | Channel Access Token + chatId | **Group ID (เลข) + Pin ID (GUID)** |
| `pas` | — | รหัส API **กลางค่าเดียวทั้งระบบ** เก็บใน env `SMARTEE_NOTIFY_PAS` (secret) |
| destination เก็บ | tokenCipher+chatId+bot | **`{ gid, pinCipher, verifiedAt }`** (Pin เข้ารหัส, ไม่มี chatId/token/pas) |

env: `SMARTEE_NOTIFY_URL` (default `https://smarteepro.com/notify/v4/api/linebot`),
`SMARTEE_NOTIFY_PAS` (ต้องตั้ง — ไม่ตั้ง dispatcher จะข้าม).

Flow ตอน subscribe (`prepareSmartSubscription`, `server/index.js`): validate gid (เลข) + pin
(GUID) → **ยิงข้อความทดสอบผ่าน relay** → relay ปฏิเสธ (gid/pin ผิด) = 400 ทันที (ไม่ fail เงียบ) →
สำเร็จค่อยบันทึก subscription (`channel='smart'`, destination = `{ gid, pinCipher }`).
dispatcher ถอดรหัส pin ต่อ tick แล้ว replay เข้า relay; 4xx จาก relay = ปิด subscription (is_active=0).

> **ทำไมใช้ `UserNotificationSubscription` ตรง ๆ ได้ (ไม่ต้องมีตาราง pairing):** เพราะ relay
> เป็นเจ้าของ binding `gid+pin → LINE group` อยู่แล้ว — ไม่มี chatId/token ที่ admin ต้องผูกฝั่งเรา
> `gid+pin` ที่ user กรอก + `pas` กลาง = credential ครบสำหรับ relay.

## Client UI: การเลือก channel (`ChannelPicker`)

แต่ละ `NotifyConfig` เก็บ channel ที่จะส่งเป็น **CSV ใน `alarm_type`** เช่น `device,line`
(`device` = web push, `line` = LINE; สตริงว่าง = ไม่แจ้งเตือน — ต้อง opt-in). ดูคอลัมน์ใน
[[schema-and-conventions]].

ฝั่ง UI เลือก channel ผ่าน component `ChannelPicker` (นิยาม local ใน
`client/src/components/SetNotifyModal.jsx`) — เป็น **segmented toggle pills** หนึ่งปุ่มต่อ channel.
ข้อควรรู้:
- เป็น **drop-in แทน `<select>` เดิม** จึง emit synthetic event `{ target: { name, value } }`
  โดย `value` เป็น CSV — `handleChangeData` ตัวเดียวจัดการทั้งฟอร์ม (key = `serial|dbKey|levelIndex|field`).
- ลำดับใน CSV ถูก normalize ตาม `CHANNEL_OPTIONS` เสมอ เพื่อให้ค่าที่ save diff สะอาด.
- ถูก `disabled` เมื่อ `point ≤ 0` (ยกเว้นแถว Normal) — ระดับที่ไม่มี threshold เลือก channel ไม่ได้.

### Convention สี: channel ↔ tier token
ใช้ **สีเดียวกับ tier token** ที่นิยามไว้ใน `client/src/index.css` (กลุ่ม `--tier-*`/`--gradient-*`):
- `device` → `--tier-free` = **น้ำเงิน** (blue-500/600) — กลุ่มเดียวกับ Web Push.
- `smart` → `--tier-smart` = **ม่วง** (violet-500/600) — Smart EE managed LINE.
- `line` → `--tier-line` = **เขียว** (green-500/600) — LINE Bot (BYO).

> เวลาเพิ่ม UI ใด ๆ ที่อ้างถึง channel/tier ให้ reuse token ชุดนี้ (อย่า hardcode สีใหม่)
> เพื่อให้สื่อความหมาย channel สอดคล้องกันทั้งแอป. ถ้าเพิ่ม channel ใหม่ ต้องเพิ่มทั้ง
> `CHANNEL_OPTIONS` (ฝั่ง modal) และ token สีใน `index.css`.

## ลำดับการบูต worker (`server/worker.js:50`)
1. เปิด DB pool → `global.dbPool`.
2. `mqttNotifier.start()`.
3. ถ้ามี VAPID → `webpushDispatcher.start()`.
4. `lineDispatcher.start()`.
5. `smartLineDispatcher.start()` (channel `smart`).
6. graceful shutdown บน SIGINT/SIGTERM: หยุด loop ก่อน → ปิด pool → exit.

> โหมด single-process: ตั้ง `ENABLE_MQTT_WORKER=true` ใน .env ของ API แล้ว index.js จะบูต worker
> ในตัว (อย่ารัน `worker.js` ซ้ำ) — `server/worker.js:20`.

## เกี่ยวข้องกับ
[[overview]] · [[schema-and-conventions]] · [[gotchas]] · [[003-smart-ee-notification-relay]]
