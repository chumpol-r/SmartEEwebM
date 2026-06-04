---
title: Realtime & Notifications
tags: [architecture, realtime, mqtt, notification, worker]
updated: 2026-06-04
sources:
  - server/worker.js
  - server/db.js
  - server/workers/mqttNotifier.js
  - server/workers/notifier_logic.js
  - server/workers/webpushDispatcher.js
  - server/workers/lineDispatcher.js
  - server/workers/smartLineDispatcher.js
  - server/utils/smartEeNotify.js
  - server/utils/lineApi.js
  - server/utils/failureReason.js
  - server/scripts/add_fail_reason_column.js
  - server/index.js:6320
  - client/src/pages/NotifyLog.jsx
  - client/src/contexts/MQTTContext.jsx
  - client/src/components/SetNotifyModal.jsx
  - client/src/components/SubscriptionModal.jsx
  - client/src/components/SubscriptionModalV2.jsx
  - client/src/components/SubscribeButton.jsx
  - client/src/components/WebPushDeviceList.jsx
  - client/src/contexts/SubscriptionContext.jsx
  - client/src/pages/NotifyConfig.jsx
  - client/src/components/Layout.jsx:141
  - client/src/index.css:90
  - server/index.js:1018
  - server/index.js:5247
  - server/index.js:5611
  - server/index.js:5640
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

### เหตุผลที่ส่งไม่สำเร็จ — `NotifyLog.fail_reason` (2026-06-04)
หน้า Notify Log มีคอลัมน์ **"Failure Reason"** อธิบายว่าทำไม noti ส่งไม่สำเร็จ เป็น **ข้อความอังกฤษ
อ่านเข้าใจง่าย** (สากล) เก็บใน `dbo.NotifyLog.fail_reason` (NVARCHAR(255)).

- คำแปลทั้งหมดอยู่ที่ util กลาง **`server/utils/failureReason.js`** (`webpushReason`/`webpushAggregateReason`/
  `lineReason`/`smartReason`) — มี channel prefix (`Web Push:`/`LINE:`/`Smart EE:`). frontend แสดง
  ค่า raw ตรง ๆ ไม่ต้อง map เอง.
- ที่มาของ error: web push มาจาก lib (`err.statusCode`/`err.code`); LINE/smart มี `err.code`/`err.status`
  จาก `lineApi`/`smartEeNotify` อยู่แล้ว.
- **กติกาเขียน (uniform):** เขียน `fail_reason` **เฉพาะตอน fail เท่านั้น** โดย channel ที่ fail —
  ไม่มีตัวไหน clear (sticky info = "เหตุผลล่าสุดที่ล้มเหลว"). webpush เขียนใน UPDATE ก้อนเดียวกับ
  `status='failed'` (aggregate หลายอุปกรณ์เป็น 1 บรรทัด); line/smart เขียนลง row ที่ส่ง fail
  (best-effort, **ไม่แตะ `status`**).
- ⚠️ **`status` เป็นของ web push เท่านั้น** (line/smart ใช้ cursor `last_delivered_log_id` ไม่แตะ
  `status`). ดังนั้น row ที่เป็น LINE-only อาจ `status='sent'` (webpush ข้ามเพราะไม่มี channel `device`)
  แต่ถ้า LINE ส่งไม่ได้จะมี `fail_reason` — **UI โชว์ `fail_reason` ไม่ขึ้นกับ `status`** จึงเห็นเหตุผล
  ครบทุก channel.
- **Deploy:** ต้องรัน `server/scripts/add_fail_reason_column.js` (idempotent) **ก่อน** deploy โค้ดใหม่
  ทุก environment — ดู [[gotchas]].

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

Flow ตอน subscribe (`prepareSmartSubscription`, `server/index.js:5411`): validate **format**
ของ gid (เลข) + pin (GUID) → บันทึก subscription ทันที (`channel='smart'`,
destination = `{ gid, pinCipher, verifiedAt: null }`). **ไม่ยิงข้อความตอน connect** —
relay ไม่มี endpoint validate แบบไม่ส่ง การ verify จริงจึงเลื่อนไปที่ปุ่ม "Send test" (ดู
[[003-smart-ee-notification-relay]] + หัวข้อ "Subscription UI" ด้านล่าง). dispatcher ถอดรหัส
pin ต่อ tick แล้ว replay เข้า relay; 4xx จาก relay = ปิด subscription (is_active=0).

> ⚠️ CONTRADICTION (2026-06-02): เดิม connect ของ smart "ยิงข้อความทดสอบผ่าน relay" เพื่อ
> verify gid/pin แล้ว fail 400 ทันทีถ้าผิด. ตอนนี้ **ตัดออกแล้ว** เพื่อไม่ให้ connect กินโควต้า LINE —
> gid/pin ที่ผิดจะ surface ตอนกด Send test หรือตอน dispatch จริง (dispatcher self-deactivate บน 4xx)
> แทน. ฝั่ง `line` ก็เลิกยิงข้อความตอน connect เช่นกัน (verify ด้วย GET ที่ไม่กินโควต้า).

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

## Subscription UI — สมัคร/จัดการ channel

มี **2 ทางเข้า** ที่ใช้ engine เดียวกัน (`Layout.jsx` ผ่าน [[#แชร์ subscription engine ข้ามหน้า subscriptioncontext]]) แต่ตอนนี้ **UI ต่างกัน**:

| ทางเข้า | component | ขอบเขต UI |
|---|---|---|
| ปุ่ม `SubscribeButton` บน header (`Layout.jsx`) | `SubscriptionModal.jsx` (V1) | **Web Push อย่างเดียว + device manager** |
| ปุ่ม "Notification Channels" บน `NotifyConfig` | `SubscriptionModalV2.jsx` (V2) | 3 การ์ด tier: `free`/`smart`/`line` (ยังเต็ม) |

> ⚠️ CONTRADICTION (2026-06-02): เดิม `SubscriptionModalV2` เป็น "design variant ที่ behavior
> เหมือน `SubscriptionModal` เป๊ะ" (ต่างแค่ shell). **ตอนนี้ไม่จริงแล้ว** — V1 ถูกรื้อให้เหลือเฉพาะ
> Web Push (ตัดการ์ด tier, SecretField, Connect/Test, ConfirmDialog ของ smart/line ออก) แล้วเพิ่ม
> **device manager** เข้าไปแทน ส่วน V2 ยัง 3-tier เหมือนเดิม. ทั้งสองยังแชร์ handler ชุดเดียวใน
> `Layout.jsx` (ไม่ duplicate logic) — ต่างกันเฉพาะ presentational. ผลคือปุ่ม header (web push)
> กับปุ่ม NotifyConfig (3 channel) **inconsistent โดยตั้งใจ** ตาม scope ที่ตกลง.

### Web Push device manager (`WebPushDeviceList`)
แยกเป็น **component ใช้ร่วม** `client/src/components/WebPushDeviceList.jsx` — ทั้ง header modal (V1)
และ V2 (การ์ด `free` ใน `NotifyConfig`) import ตัวเดียวกัน → device UI มี source เดียว ไม่ drift.
V2 รับ `devices`/`currentDeviceId`/`onRemoveDevice` ผ่าน `SubscriptionContext` (เพิ่มเข้า value แล้ว);
component ถือเฉพาะ state confirm/removing/error ต่อ row ส่วน data + action มาจาก engine ใน `Layout.jsx`.

โชว์ **รายการอุปกรณ์ทั้งหมดของ account** ที่ subscribe Web Push ไว้ พร้อมลบรายเครื่อง:
- ข้อมูลมาจาก `GET /api/subscription` (`server/index.js:5247`) — query `WHERE user_id = @userId AND
  is_active = 1 ORDER BY updated_at DESC` (user จาก token ไม่ใช่ client). `Layout.jsx` `refreshSubscriptions`
  กรองเหลือ `channel === 'webpush'` เก็บใน state `webPushDevices` → ส่งเข้า modal เป็น prop `devices`.
- แต่ละ row = 1 `subscription_id`; **`isThisDevice` = `device_id === getDeviceId()`** (`getDeviceId` อ่านจาก
  `localStorage.deviceId` — UUID สุ่มถาวรต่อ browser). `device_label` (`"Chrome on Windows"`) ใช้ **display
  อย่างเดียว ไม่ unique** — match/ลบ ใช้ `subscription_id`/`device_id` เท่านั้น.
- **ลบ** = `DELETE /api/subscription/:id` (`server/index.js:5611`, soft-delete `is_active=0` + ownership
  check). เครื่องนี้: `pushManager.unsubscribe()` + DELETE; เครื่องอื่น: DELETE อย่างเดียว (revoke
  pushManager ของเครื่องอื่นไม่ได้ — browser นั้นเหลือ subscription ค้างแต่จะไม่ถูกส่งถึงอีก). UI ใช้
  **inline confirm** ต่อ row (ไม่เด้ง dialog ซ้อน).
- ปุ่ม footer **"Enable Web Push" โผล่เฉพาะตอนเครื่องนี้ยังไม่ subscribe** — ลบเครื่องนี้ทำผ่าน row
  (badge "This device") จึงไม่มี disable affordance ซ้ำซ้อน.
- **ทุก mutation (subscribe/unsubscribe/removeDevice) เรียก `refreshSubscriptions()` หลังสำเร็จ** เพื่อให้
  `webPushDevices` ไม่ stale (bug เดิม: subscribe แล้ว list ไม่ขึ้นจนกว่าจะ refresh หน้า เพราะ handler
  set แค่ `isSubscribed` ไม่ได้ refresh).
- **Security:** `sanitizeDestination` คืน `null` สำหรับ channel `webpush` (`server/index.js:5262`) —
  ไม่ส่ง `endpoint`/`p256dh`/`auth` keys ออก client (client ไม่ได้ใช้). response เพิ่ม `createdAt`
  ไว้โชว์ "Added …".

> **smart/line ไม่ใช่ "อุปกรณ์"** — เป็น account-level จึงไม่อยู่ใน device list (กรองออกตั้งแต่
> `channel === 'webpush'`) และจัดการที่ V2 (`NotifyConfig`) เท่านั้น. หัวข้อด้านล่าง
> (Connected read-only / Connect-vs-Test / `/test`) จึงใช้กับ **V2** เป็นหลัก.

**สถานะ per-channel (`channelStatus`)** — `Layout.jsx:141` เก็บ map ต่อ channel
`{ subscribed, subscriptionId, info }` โดย build จาก `GET /api/subscription`
(`server/index.js:5247`, sanitize destination แล้ว). `free` ผูกกับ **device นี้** (match `deviceId`),
ส่วน `smart`/`line` เป็นระดับ **account**. `refreshSubscriptions()` re-fetch หลังทุก mutation
เพื่อไม่ให้ state drift. `currentTier` (สำหรับสีปุ่ม `SubscribeButton`) เป็น derived: line > smart > free.

**Connected = read-only (ไม่มี reconnect/disconnect ในนี้)** — เมื่อ `smart`/`line` เชื่อมแล้ว
modal โชว์ `ConnectedSummary` (locked) แสดง destination ที่ sanitize (Group ID / Bot→Group)
+ `verifiedAt` + กล่อง **warning amber**: "การเปลี่ยนห้อง/กลุ่มอาจมีค่าใช้จ่าย ให้ติดต่อเจ้าหน้าที่"
จงใจ **ไม่มีปุ่มแก้/ตัดการเชื่อมต่อ** — ต้องไปทำกับเจ้าหน้าที่.

**แยก Connect ออกจาก Test (quota-aware)** — ดูเหตุผลเต็มใน [[003-smart-ee-notification-relay]]:
- **Connect ไม่กินโควต้า**: `line` verify ด้วย GET (`getBotInfo`+`verifyChatTarget`, `server/utils/lineApi.js`),
  `smart` validate format อย่างเดียว.
- **ปุ่ม "Send test notification"** (footer, สี **amber→orange**) → เปิด `ConfirmDialog` ซ้อน
  เตือนว่ากิน **push-message quota** ของ LINE → ยืนยันค่อยยิง → มี **cooldown 5 วิ แบบ countdown**
  (mirror กับ server). โชว์ปุ่มเมื่อ channel เชื่อมแล้ว (locked) หรือเพิ่ง connect สำเร็จ.

**`POST /api/subscription/:id/test`** (`server/index.js:5640`) — ยิงข้อความทดสอบ 1 ครั้ง:
- เช็ค ownership (`user_id`) + active; `line` → `DecryptToken(tokenCipher)` → `pushTextMessage`;
  `smart` → `DecryptToken(pinCipher)` → `smartEeNotify.sendNotify` (reuse util ชุดเดียวกับ dispatcher).
- ข้อความ **แยกตาม channel** (`server/index.js:5689`): `✅ LINE Bot Notification Connected` /
  `✅ Smart EE Notification Connected` + บรรทัดยืนยันว่าเป็นข้อความทดสอบ (newline จริงของ smart
  ถูก `smartEeNotify` แปลงเป็น literal `\n` ให้ — ดู [[gotchas]]).
- **cooldown ฝั่ง server 5 วิ/subscription** (in-memory Map, mark ก่อนส่ง — fail ก็ยัง throttle) คืน
  429 + `retryAfter`. สำเร็จ → stamp `verifiedAt` ลง destination → badge "Verified".

### แชร์ subscription engine ข้ามหน้า (`SubscriptionContext`)

`SubscriptionModal` (และ `SubscriptionModalV2`) เป็น **presentational ล้วน** — ถือแค่ state ของฟอร์ม
(ค่าที่พิมพ์/visibility/cooldown). **ตรรกะจริงทั้งหมดอยู่ใน `Layout.jsx`** ไม่ใช่ในตัว modal:
`channelStatus` + `refreshSubscriptions()`, `handleSubscribe`/`handleUnsubscribe` (Web Push:
permission+SW+VAPID), `handleSubscribeLine`/`handleSubscribeSmart`, `handleSendTest`,
`handleModalSubmit` (`onSubmit` รวม), `getDeviceId`, `currentTier`. modal รับทุกอย่างผ่าน props.

เพื่อให้หน้าอื่น (เช่น `NotifyConfig`) เปิด modal สมัครได้เองโดย **ไม่ duplicate logic 250+ บรรทัดนั้น**
และ **ไม่เกิด state drift** (โดยเฉพาะ Web Push ที่ผูก device นี้ — ถ้ามี state ชุดที่สองจะโชว์ subscribed
ไม่ตรงกัน) จึงมี `client/src/contexts/SubscriptionContext.jsx`:

- `Layout.jsx` ครอบ tree ด้วย `<SubscriptionContext.Provider>` ส่ง value
  `{ currentTier, webPushSubscribed, channelStatus, onSubmit, onSendTest }` (engine เดิม — logic ไม่ย้าย).
- หน้าใดที่อยู่ใน `<Layout>` (ทุก `ProtectedRoute` ผ่าน `App.jsx` → `<Layout>{children}`) เรียก
  `useSubscription()` ดึง props ชุดเดียวกัน แล้ว render modal ของตัวเองด้วย **local open state**.
- `useSubscription()` **throw ถ้าถูกใช้นอก Provider** (fail ชัด ไม่ใช่ undefined เงียบ ๆ).

**`SubscriptionModalV2.jsx`** = modal 3-tier เต็ม (free/smart/line) ใช้ใน `NotifyConfig.jsx` ผ่านปุ่ม
**"Notification Channels"** ที่ header. เดิมคัดลอก behavior จาก `SubscriptionModal` เป๊ะ แต่หลัง
2026-06-02 **V1 รื้อเป็น Web Push-only แล้ว V2 ยังเต็ม** (ดู CONTRADICTION ด้านบน). ทั้งคู่ยังอ่าน/เขียน
`channelStatus`/engine ก้อนเดียวกันผ่าน context → smart/line ที่ connect จาก V2 ยัง sync ทุกที่.

> ถ้าจะปรับ flow การ subscribe (เพิ่ม channel, เปลี่ยน payload) ให้แก้ที่ handler ใน `Layout.jsx`
> ที่เดียว — modal ทุกตัว (V1/V2) ได้ผลตามอัตโนมัติ. ส่วน design แก้แยกในไฟล์ modal นั้น ๆ ได้อิสระ.

## ลำดับการบูต worker (`server/worker.js:50`)
1. เปิด DB pool → `global.dbPool`.
2. `mqttNotifier.start()`.
3. ถ้ามี VAPID → `webpushDispatcher.start()`.
4. `lineDispatcher.start()`.
5. `smartLineDispatcher.start()` (channel `smart`).
6. graceful shutdown บน SIGINT/SIGTERM: หยุด loop ก่อน → ปิด pool → exit.

> โหมด single-process: ตั้ง `ENABLE_MQTT_WORKER=true` ใน .env ของ API แล้ว index.js จะบูต worker
> ในตัว (อย่ารัน `worker.js` ซ้ำ) — `server/worker.js:20`.

## Worker resilience (2026-06-04)
แก้ failure mode ที่อันตรายสุดของ worker — **"ตายเงียบ"** (process ยังขึ้นแต่ไม่ทำงานจริง):

- **DB auto-reconnect (`server/db.js`):** เดิม pool หลุด (SQL restart/failover/network blip) แล้ว
  ทุก query fail เงียบ → ไม่มี NotifyLog ถูก insert จนกว่าจะ restart มือ. ตอนนี้ `pool.on('error')`
  rebuild pool ใหม่วนไม่จบแบบ backoff (`DB_RECONNECT_*`) + **reassign `global.dbPool`** → dispatcher
  ทุกตัว (อ่าน `global.dbPool` สด) self-heal เอง. `mqttNotifier` เลิก capture pool → ใช้ `getPool()`
  สดทุก tick/message (ถ้า pool กำลัง reconnect = drop message นั้น; `clean:false`+QoS1 ให้ broker
  เก็บคิวให้).
- **Boot retry (`server/db.js`):** `connectToDb` retry แบบ exponential backoff ตอนบูต (`DB_BOOT_*`)
  → ทน worker สตาร์ทก่อน SQL Server ตอน reboot (เดิม fail ทันที → crash-loop).
- **Global guards (`server/worker.js`):** `unhandledRejection` = log แล้วอยู่ต่อ;
  `uncaughtException` = log แล้ว `exit(1)` ให้ supervisor restart สะอาด. callback ของ setInterval
  (config refresh/sweep) ใน `mqttNotifier` ห่อ `.catch()` แล้ว.
- ⚠️ โหมด single-process (`ENABLE_MQTT_WORKER=true` ใน `index.js`) **ยังไม่มี global guard ชุดนี้**.

> Failure mode อื่นที่ยัง **ค้าง** (ยังไม่แก้): leak ของ `runtimeState` สำหรับ alarm ที่ breach สั้น ๆ
> แล้วเงียบ (sweep ลบเฉพาะ `raiseLogId != null`); ไม่มี backpressure ตอน message flood; ไม่มี
> heartbeat/alert เมื่อ MQTT auth fail แล้ว reconnect วนเงียบ. ดูรายการเต็มในบันทึก review 2026-06-04.

## เกี่ยวข้องกับ
[[overview]] · [[schema-and-conventions]] · [[gotchas]] · [[003-smart-ee-notification-relay]]
