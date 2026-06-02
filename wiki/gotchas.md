---
title: Gotchas & ข้อควรระวัง
tags: [gotchas, pitfalls]
updated: 2026-06-01
sources:
  - server/index.js
  - server/db.js
  - server/utils/crypto.js
  - server/utils/smartEeNotify.js
  - client/src/components/Layout.jsx
---

# Gotchas & ข้อควรระวัง

รวมกับดักที่ทำให้เสียเวลา/เกิดบั๊ก เพิ่มรายการใหม่ทุกครั้งที่เจอของจริง.

## DB & SQL Server

- **`CHAR` มี space ต่อท้าย** → ต้อง `.trim()` ค่า id ทุกครั้งก่อนเทียบ ไม่งั้น `'200000001 ' !== '200000001'`.
  ตัวอย่าง: `server/index.js:118`, `:211`. เป็นสาเหตุ "permission/lookup พังแบบหาเหตุไม่เจอ" ที่พบบ่อย.
- **`WebUser.c_id` เป็น polymorphic** (group หรือ site) — ต้องลองหาทั้งสองตาราง อย่า assume.
  ดู [[auth-and-permissions]].
- **ไม่มี ORM/migration** — แก้ schema ด้วย raw SQL/สคริปต์ใน `server/scripts/` เท่านั้น.
- การต่อ DB ใช้ Windows Auth เป็น default บน dev (`server/db.js`) — บน Linux/cloud ต้องตั้ง
  `DB_TRUSTED=false` + `DB_USER`/`DB_PASS` ไม่งั้นต่อไม่ติด.

## Auth & Security (รับสืบทอดมา — ดู [[002-why-no-jwt]])

- token ไม่มี expiry/signature; คีย์ crypto hard-code.
- มี `console.log` token/userId หลายจุด — อย่าก๊อปแพตเทิร์นนี้ไปโค้ดใหม่ และระวังตอนแชร์ log.
- `WebUser.c_type` (role) **เข้ารหัส** — ต้อง `Decrypt` + ตัด prefix อีเมลก่อนใช้ (`server/index.js:234`).
- เพิ่มเมนูใหม่ต้องอัปเดต **ทั้ง** `MENU_IDS` (`client/src/App.jsx:29`) และ `WebMenu`/`WebPermission`
  ไม่งั้นหน้าใหม่จะ "ผ่านเงียบ" (path ไม่อยู่ใน map = allow) หรือ "deny by default".

## SQL injection

- `/api/realtime` ต่อ `IN (...)` จาก query string โดยตรง — กันด้วย `parseInt`+`filter(!isNaN)`
  (`server/index.js:1029`). ปลอดภัยเฉพาะเพราะค่าควรเป็น int. **route อื่นที่รับสตริงต้องใช้
  parameterized query (`.input(...)`) เสมอ** ไม่ใช่ string interpolation.

## โครงสร้างโค้ด

- `server/index.js` เป็น monolith ~6,350 บรรทัด — ใช้ค้นด้วยเลขบรรทัด/route prefix
  (`grep "app\.\(get\|post\)"`) แทนการไล่อ่าน. route ซ้ำ/มี comment-out อยู่บ้าง
  (เช่น `/api/system/config` ปรากฏ 2 ครั้ง: `:982` กับ `:2484`).
- ฝั่ง config ของ MQTT มาจากทั้ง env และ JSON — env ชนะ. ตรวจทั้งสองที่เวลา debug
  (`server/workers/mqttNotifier.js:80`).

## Worker / Notification

- ถ้า web push ไม่ส่ง: เช็คว่าตั้ง `VAPID_*` ครบ และ `VAPID_SUBJECT` ขึ้นต้น `mailto:`/`https://`
  (iOS/APNs ตอบ 403 ถ้าเป็นอีเมลเปล่า) — `server/worker.js:32`.
- อย่ารัน `worker.js` พร้อมกับตั้ง `ENABLE_MQTT_WORKER=true` — จะได้ MQTT notifier ซ้ำสองตัว.

### Smart EE relay (channel `smart` — `server/utils/smartEeNotify.js`)
- **relay รับ newline จริงไม่ได้** — ส่ง message ที่มี `\n`/`\r\n` (real byte) ไป relay ของ
  smarteepro.com จะตอบ **400 Bad Request** (ทั้ง urlencoded และ multipart). ต้องแปลงเป็น
  **literal `\n` (สองตัวอักษร backslash+n)** ก่อนส่ง — relay จะไปขยายเป็นบรรทัดใหม่ฝั่ง LINE เอง.
  โค้ดทำให้แล้วใน `sendNotify` (`.replace(/\r\n?|\n/g, '\\n')`). **นี่คือสาเหตุจริงของ 400** ที่
  หลอกว่าเป็นเรื่อง body encoding ตอนแรก.
- **อย่าใช้ `FormData` (undici) กับ relay นี้** — multipart ที่ Node สร้างโดน relay (parser legacy)
  ปฏิเสธ 400; ใช้ `application/x-www-form-urlencoded` (`URLSearchParams`) แทน. ข้อความล้วนไม่ต้องใช้
  multipart อยู่แล้ว.
- ต้องตั้ง env `SMARTEE_NOTIFY_PAS` (รหัส API กลาง) — ไม่ตั้ง: ตอน subscribe ตอบ 500 `not_configured`,
  ฝั่ง dispatcher จะ **ข้ามเงียบ** (ไม่ส่ง ไม่ crash). ดู [[003-smart-ee-notification-relay]].

### UI error handling (notification subscribe)
- **webpush (free tier) แจ้ง error ไม่เหมือน line/smart** — `handleSubscribe` ใน `Layout.jsx` จับ error
  เองแล้ว `alert()` **โดยไม่ throw ต่อ** → เวลา subscribe ผ่าน modal, modal เด้ง "Activated" ทั้งที่ล้มเหลว
  (permission denied ก็เงียบ). line/smart โชว์ error เป็นกล่อง inline พร้อม hint. (known gap — ยังไม่แก้)

## เอกสารที่ทำให้สับสน

- `C:\Workspaces\CLAUDE.md` อธิบายโปรเจกต์ *SmartCatcherPro* (monorepo, TimescaleDB, JWT,
  Drizzle) — **คนละโปรเจกต์**. อย่าใช้คำสั่ง `pnpm`/`turbo`/`db:migrate` จากไฟล์นั้นกับ repo นี้.
