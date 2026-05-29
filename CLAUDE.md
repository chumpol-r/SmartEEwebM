# CLAUDE.md — SmartEE Web

คำแนะนำสำหรับ Claude Code เมื่อทำงานใน repo นี้.

> ⚠️ **อย่าใช้ `C:\Workspaces\CLAUDE.md` (โฟลเดอร์แม่) กับ repo นี้** — ไฟล์นั้นอธิบายโปรเจกต์
> *SmartCatcherPro* (monorepo + TimescaleDB + JWT + Drizzle) ซึ่งเป็น **คนละโปรเจกต์**.
> repo นี้คือ SmartEE Web (client/server + SQL Server + custom token). ยึดไฟล์นี้และ `wiki/` เป็นหลัก.

## 📚 อ่านวิกิก่อนเริ่มงาน (สำคัญ)

ก่อนเริ่มงานที่เกี่ยวกับ **ฟีเจอร์ / สถาปัตยกรรม / การแก้ระบบ** ให้อ่าน **`wiki/index.md`** ก่อนเสมอ
เพื่อหาหน้าที่เกี่ยวข้องแล้วค่อย drill เข้าไป — ความรู้เชิงระบบถูก compile ไว้ในวิกินั้นแล้ว
(ประหยัดการไล่อ่าน `server/index.js` ~6,350 บรรทัด).

- กติกาการดูแลวิกิ + workflow (ingest / query / lint): `wiki/WIKI.md`
- เมื่อ user พูดว่า **"ingest"** / **"query wiki"** / **"lint วิกิ"** → ทำตาม workflow ใน `wiki/WIKI.md`.
- จบงานที่เพิ่มฟีเจอร์/ตัดสินใจสถาปัตยกรรม/เจอกับดักใหม่ → เสนอ ingest กลับเข้าวิกิ.

## ภาพรวมโปรเจกต์ (ย่อ — รายละเอียดอยู่ใน wiki/)

- **client/** — React 18 + Vite 7 + Tailwind 4 SPA (`client/src/App.jsx`).
- **server/** — Express 4 monolith (`server/index.js`) บน **Microsoft SQL Server** (mssql/msnodesqlv8).
- **server/worker.js** — process แยก: MQTT notifier + web push + LINE dispatcher.
- Auth = **custom token (port จาก VB6) ไม่ใช่ JWT**; permission แบบ Group/Site/Super Group.
- ดูเต็ม: `wiki/architecture/overview.md`, `wiki/db/schema-and-conventions.md`, `wiki/gotchas.md`.

## คำสั่งที่ใช้บ่อย

```bash
# client/ (React)
npm run dev          # Vite dev server
npm run build
npm run lint

# server/ (API)
npm run dev          # nodemon index.js
npm run worker:dev   # nodemon worker.js (MQTT/notification)
npm test             # node --test workers/notifier_logic.test.js
npm run pm2:start    # รันด้วย PM2 (ecosystem.config.js)
```

## ข้อควรระวังหลัก (รายละเอียดเต็มใน wiki/gotchas.md)

- คอลัมน์ `CHAR` ใน SQL Server มี space ต่อท้าย → `.trim()` ก่อนเทียบ id เสมอ.
- `WebUser.c_id` เป็น polymorphic (ชี้ Group หรือ Site) — ต้องเช็คทั้งสองตาราง.
- ไม่มี ORM/migration — แก้ schema ด้วย raw SQL/สคริปต์ใน `server/scripts/`.
- route ที่รับ input เป็นสตริงต้องใช้ parameterized query (`.input(...)`) ไม่ใช่ string interpolation.

## ภาษา
ตอบและเขียนเอกสารเป็น **ภาษาไทย** (ศัพท์เทคนิค/ชื่อตาราง/ฟังก์ชันคงภาษาอังกฤษ).
