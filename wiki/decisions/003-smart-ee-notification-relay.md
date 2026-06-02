---
title: ADR 003 — Smart EE Notification ส่งผ่าน relay (ไม่ใช่ LINE Messaging API)
tags: [decision, adr, notification, line, smart, relay]
updated: 2026-06-02
sources:
  - server/utils/smartEeNotify.js
  - server/workers/smartLineDispatcher.js
  - server/index.js
  - client/src/components/SubscriptionModal.jsx
---

# ADR 003 — Smart EE Notification ส่งผ่าน relay (ไม่ใช่ LINE Messaging API)

**สถานะ:** ใช้งานอยู่ (active) — เพิ่ม channel `smart` เข้าระบบ notification

## บริบท
ต้องเพิ่มช่องทางแจ้งเตือนใหม่ "Smart EE Notification" ที่ผู้ใช้กรอกแค่ **Group ID (เลข)** +
**Pin ID (GUID)** แล้วให้ข้อความไปออกที่ **LINE group** ของผู้ใช้ ต่างจาก channel `line` เดิม
ที่เป็นแบบ BYO-bot (ผู้ใช้เอา Channel Access Token + chatId ของตัวเองมา).

ระหว่างออกแบบเคยพิจารณา 2 ทางที่ **ตกไป**:
1. **เก็บ LINE token + chatId เองในตาราง `SmartLinePairing`** แล้วคุย LINE Messaging API ตรง
   (แบบ admin ผูก binding `gid+pin → chatId+token`). — ออกแบบไปแล้วแต่ทิ้ง เพราะ...
2. ...พบว่ามี **relay API กลางของ smarteepro.com** อยู่แล้ว ที่ **เป็นเจ้าของ binding
   `gid+pin → LINE group ไหน` เอง**.

## การตัดสินใจ
ส่งผ่าน relay ของ smarteepro.com ไม่คุย LINE Messaging API ตรง และ **ไม่ต้องมีตาราง pairing**:

```
POST {SMARTEE_NOTIFY_URL}                 (application/x-www-form-urlencoded)
  configure = "gid=<gid>&pin=<pin>&pas=<pas>"
  message   = "<text>"
```

- `pas` = รหัส API **กลางค่าเดียวทั้งระบบ** เก็บใน env `SMARTEE_NOTIFY_PAS` (secret).
- subscription เก็บใน `UserNotificationSubscription` ตามเดิม (channel=`smart`),
  destination = `{ gid, pinCipher, verifiedAt }` — Pin เข้ารหัส, **ไม่มี chatId/token/pas ใน row**.
- ตอน subscribe: `prepareSmartSubscription` validate **format** (gid เลข + pin GUID) แล้วบันทึก
  ทันทีด้วย `verifiedAt: null` — **ไม่ยิงข้อความตอน connect** (ดู update ด้านล่าง).
- ตอน dispatch: `smartLineDispatcher` ถอดรหัส pin ต่อ tick แล้ว replay เข้า relay
  (match `alarm_type` ด้วย token `smart`, cursor/scope เหมือน `lineDispatcher`).

> 🔄 UPDATE (2026-06-02) — แยก Connect ออกจาก Test (quota-aware):
> เดิม `prepareSmartSubscription` (และ `prepareLineSubscription`) **ยิงข้อความทดสอบตอน connect**
> เพื่อ verify end-to-end. ปัญหา: ทุกข้อความ LINE นับ **push-message quota** ของผู้ใช้ → connect
> กินโควต้าเงียบ ๆ. ตอนนี้:
> - **`line` connect** verify ด้วย GET เท่านั้น (`getBotInfo`+`verifyChatTarget`) — ไม่กินโควต้า.
> - **`smart` connect** validate format อย่างเดียว เก็บ `verifiedAt: null` (relay ไม่มี read-only validate).
> - การ verify จริงย้ายไปปุ่ม **"Send test notification"** → `POST /api/subscription/:id/test`
>   (`server/index.js:5640`) ที่ผู้ใช้ยืนยันก่อน + มี cooldown 5 วิ; สำเร็จแล้ว stamp `verifiedAt`.
> - ผล: gid/pin ผิดของ smart จะไม่ fail ตอน connect อีกต่อไป — surface ตอนกด test หรือ dispatch จริง
>   (dispatcher self-deactivate บน 4xx). ดูกลไก UI เต็มที่ [[realtime-and-notifications]].

**เหตุผล:** relay ถือ binding อยู่แล้ว → ฝั่งเราไม่ต้องจัดการ chatId/token, ไม่ต้องมีตาราง/Admin UI
ผูกกลุ่ม, ลด secret ที่ต้องเก็บ และตอบโจทย์ "ผู้ใช้กรอกแค่ Group ID + Pin ID" โดยตรง.

## ผลที่ตามมา / ข้อจำกัด
- **ผูกกับ relay ภายนอก** — ถ้า smarteepro.com ล่ม channel นี้ส่งไม่ได้ (5xx/network → dispatcher retry).
- `pas` เป็น secret กลางค่าเดียว — รั่วแล้วกระทบทุก group; ต้องไม่ลง log/DB.
- โควต้า/rate-limit ของ relay ถูกแชร์กันทั้งระบบ.
- relay มีข้อจำกัดเรื่อง newline (ดู [[gotchas]]).

> ถ้าอนาคตต้องการ image notification (relay รองรับ `imageFile`) ค่อยทำ multipart ให้
> curl-compatible (ดูเหตุผลที่เลือก urlencoded ใน [[gotchas]]).

ดูกลไกเต็มที่ [[realtime-and-notifications]] · กับดักที่ [[gotchas]].
