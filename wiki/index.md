# Index — สารบัญวิกิ SmartEE Web

สารบัญทุกหน้าในวิกิ. LLM อ่านไฟล์นี้ก่อนเสมอเวลาตอบคำถาม เพื่อหาหน้าที่เกี่ยวข้องแล้วค่อย drill เข้าไป.
กติกาการดูแลวิกิอยู่ใน [WIKI.md](WIKI.md).

_อัปเดตล่าสุด: 2026-06-01_

## 👋 เริ่มที่นี่
- [HOW-TO-USE](HOW-TO-USE.md) — **คู่มือใช้งานฉบับเข้าใจง่าย + คลังตัวอย่าง prompt** (อ่านก่อนถ้าเพิ่งเริ่ม/เพิ่งเข้าทีม).

## Architecture
- [overview](architecture/overview.md) — ภาพรวม 3 ส่วน (client / API / worker) + DB + deployment.
- [auth-and-permissions](architecture/auth-and-permissions.md) — custom token (ไม่ใช่ JWT) + ระบบสิทธิ์ Group/Site/Super Group.
- [realtime-and-notifications](architecture/realtime-and-notifications.md) — REST realtime จาก DB + MQTT→NotifyLog→push (web/LINE/smart) + channel `smart` (relay smarteepro.com) + UI เลือก channel (`ChannelPicker`) + convention สี tier.

## Database
- [schema-and-conventions](db/schema-and-conventions.md) — SQL Server, naming convention (`c_/n_/u_/dt_`), ลำดับชั้น Group→Site→Serial, ตารางหลัก.

## Decisions (ADR)
- [001-separate-worker-process](decisions/001-separate-worker-process.md) — ทำไมแยก worker เป็น process ต่างหาก.
- [002-why-no-jwt](decisions/002-why-no-jwt.md) — ทำไมใช้ custom token แทน JWT.
- [003-smart-ee-notification-relay](decisions/003-smart-ee-notification-relay.md) — channel `smart` ส่งผ่าน relay smarteepro.com (ไม่ใช่ LINE API ตรง / ไม่มีตาราง pairing).

## Misc
- [gotchas](gotchas.md) — กับดัก/ข้อควรระวัง (CHAR trailing space, polymorphic c_id, SQL injection, VAPID ฯลฯ).

---

### หน้าที่ยังควรเพิ่ม (backlog)
- `architecture/custom-views.md` — ระบบ CustomViews + การ export/public share.
- `architecture/billing-and-carbon.md` — billing rates + carbon credit.
- `db/er-diagram.md` — ER diagram จริงจาก `inspect_table.js`.
