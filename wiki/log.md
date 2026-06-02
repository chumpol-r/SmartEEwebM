# Log — บันทึกการเปลี่ยนแปลงวิกิ (append-only)

แต่ละ entry ขึ้นต้นด้วย `## [YYYY-MM-DD] <op> | <หัวข้อ>` เพื่อ grep ได้:
`grep "^## \[" wiki/log.md | tail -5`

---

## [2026-05-29] bootstrap | สร้างวิกิเริ่มต้น
สร้างโครง wiki/ + schema (WIKI.md) และ ingest ครั้งแรกจากโค้ดจริง (branch `module-Realtime.jsx`).
หน้าที่สร้าง:
- WIKI.md, index.md, log.md
- architecture/overview, architecture/auth-and-permissions, architecture/realtime-and-notifications
- db/schema-and-conventions
- decisions/001-separate-worker-process, decisions/002-why-no-jwt
- gotchas

ประเด็นสำคัญที่บันทึก: stack จริงคือ React 18 + Express 4 + **SQL Server** + **custom token (ไม่ใช่ JWT)**
— ไม่ตรงกับ `C:\Workspaces\CLAUDE.md` (อธิบาย SmartCatcherPro คนละโปรเจกต์).

## [2026-05-29] ingest | คู่มือใช้งานสำหรับทีม
สร้าง `HOW-TO-USE.md` (คู่มือเข้าใจง่าย + คลังตัวอย่าง prompt หลาย use case) และลิงก์จาก `index.md`.

## [2026-05-29] ingest | ChannelPicker UI + convention สี tier
เพิ่มหัวข้อ "Client UI: การเลือก channel" ใน `architecture/realtime-and-notifications.md`:
- `ChannelPicker` (segmented toggle pills, local ใน `SetNotifyModal.jsx`) เป็น drop-in แทน `<select>`
  เดิม — emit synthetic onChange ค่าเป็น CSV (`device,line`); disabled เมื่อ point ≤ 0.
- **Convention สี channel ↔ tier token** (`client/src/index.css:90`): `device → --tier-free` (น้ำเงิน),
  `line → --tier-line` (เขียว) — UI ที่อ้าง channel ให้ reuse token ชุดนี้ อย่า hardcode สีใหม่.
อัปเดต sources + index.md ด้วย.

## [2026-06-01] ingest | channel `smart` (Smart EE Notification ผ่าน relay)
เพิ่ม channel `smart` เข้าระบบ notification — ผู้ใช้กรอก Group ID + Pin ID แล้วส่งผ่าน **relay
ของ smarteepro.com** (ไม่ใช่ LINE Messaging API ตรง, ไม่มีตาราง pairing). หน้าที่แตะ:
- **decisions/003-smart-ee-notification-relay** (ใหม่) — ADR เลือก relay แทน LINE API/pairing table.
- **architecture/realtime-and-notifications** — เพิ่มหัวข้อ "Channel `smart`" + dispatcher `smartLineDispatcher`
  + boot step 5 + สี `--tier-smart` (ม่วง); อัปเดต sources.
- **gotchas** — relay รับ newline จริงไม่ได้ (ต้อง literal `\n`); ห้ามใช้ undici `FormData` (ใช้
  urlencoded); ต้องตั้ง `SMARTEE_NOTIFY_PAS`; + known gap webpush error handling (alert ไม่ throw).
- **db/schema-and-conventions** — `UserNotificationSubscription` รองรับ channel `smart`
  (destination `{gid,pinCipher}`); ไม่มีตาราง pairing.
โค้ดจริง: `server/utils/smartEeNotify.js`, `server/workers/smartLineDispatcher.js`,
`prepareSmartSubscription`/sanitize ใน `server/index.js`, `SubscriptionModal.jsx`, `SetNotifyModal.jsx`.
