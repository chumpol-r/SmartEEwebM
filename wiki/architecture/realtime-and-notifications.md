---
title: Realtime & Notifications
tags: [architecture, realtime, mqtt, notification, worker]
updated: 2026-05-29
sources:
  - server/worker.js
  - server/workers/mqttNotifier.js
  - server/workers/notifier_logic.js
  - server/workers/webpushDispatcher.js
  - server/workers/lineDispatcher.js
  - client/src/contexts/MQTTContext.jsx
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

## ลำดับการบูต worker (`server/worker.js:50`)
1. เปิด DB pool → `global.dbPool`.
2. `mqttNotifier.start()`.
3. ถ้ามี VAPID → `webpushDispatcher.start()`.
4. `lineDispatcher.start()`.
5. graceful shutdown บน SIGINT/SIGTERM: หยุด loop ก่อน → ปิด pool → exit.

> โหมด single-process: ตั้ง `ENABLE_MQTT_WORKER=true` ใน .env ของ API แล้ว index.js จะบูต worker
> ในตัว (อย่ารัน `worker.js` ซ้ำ) — `server/worker.js:20`.

## เกี่ยวข้องกับ
[[overview]] · [[schema-and-conventions]] · [[gotchas]]
