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
