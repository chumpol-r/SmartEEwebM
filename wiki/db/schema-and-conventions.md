---
title: DB Schema & Conventions
tags: [db, sql-server, schema, convention]
updated: 2026-06-04
sources:
  - server/db.js
  - server/utils/idGenerator.js
  - server/index.js
---

# DB Schema & Conventions

ฐานข้อมูลคือ **Microsoft SQL Server** (ไม่ใช่ Postgres/TimescaleDB). schema สืบทอดจากระบบ
ASP/VB เดิม — ตาราง/คอลัมน์จึงใช้ naming แบบ Hungarian และไม่มี migration tool
(แก้ schema ด้วย SQL/สคริปต์ตรง ๆ ใน `server/scripts/`).

## การเชื่อมต่อ (`server/db.js`)

- ใช้ `mssql/msnodesqlv8` + **ODBC Driver 17 for SQL Server**.
- ค่าจาก env (มี fallback เป็น dev local):
  - `DB_SERVER` (default `INNOTUC01\SQLEXPRESS`), `DB_NAME` (default `db_energy_oee_dev`).
  - `DB_TRUSTED` — true = Windows Auth (default ตอน dev), false = SQL Auth (`DB_USER`/`DB_PASS`,
    ใช้บน Linux/cloud).
  - บังคับ `Encrypt=Yes; TrustServerCertificate=Yes`.
- pool เป็น **singleton** `global.dbPool` แปะเป็น `req.db` (`server/index.js:60`).
- **Resilience (2026-06-04):** `connectToDb` retry แบบ exponential backoff ตอนบูต (env `DB_BOOT_MAX_RETRIES`
  /`DB_BOOT_RETRY_BASE_MS`/`DB_BOOT_RETRY_CAP_MS`) และ pool มี `pool.on('error')` ที่ auto-reconnect
  วนไม่จบ (env `DB_RECONNECT_BASE_MS`/`DB_RECONNECT_CAP_MS`) แล้ว **reassign `global.dbPool`**. มี
  `getPool()` คืน pool ปัจจุบันเสมอ — ใช้แทนการ capture reference. ดู [[realtime-and-notifications]].

## Naming convention (สำคัญ — ต้องรักษาไว้)

คอลัมน์ใช้ prefix บอกชนิด:

| prefix | ชนิด | ตัวอย่าง |
|--------|------|----------|
| `c_` | string/char | `c_id`, `c_type`, `c_active`, `c_email`, `c_name`, `c_machine_id` |
| `n_` | number | `n_menu`, `n_site`, `n_production`, `n_column`, `n_val` |
| `u_` | uniqueidentifier (GUID) | `u_id` (PK ของ `WebUser`) |
| `dt_` | datetime | `dt_job_time` |
| `b_` | boolean/flag | (พบในสคริปต์ schema) |

⚠️ **คอลัมน์ `CHAR` มี space ต่อท้าย** — โค้ดจึง `.trim()` ค่า id เกือบทุกที่ก่อนเทียบ
(`server/index.js:118`, `:211`). อย่าลืมเวลาเขียน query/เทียบใหม่. ดู [[gotchas]].

## ลำดับชั้นองค์กร (multi-tenant)

```
WebGroup  (องค์กร)   c_id ∈ 200,000,000 – 299,999,999   ; Super Group = c_active 'Z'
   │  (ผูกผ่าน WebMainSub: main_type='G', sub_type='S')
   ▼
WebSite   (ไซต์/สาขา) c_id ∈ 100,000,000 – 199,999,999
   │
   ▼
WebSerial (มิเตอร์/ซีเรียล) c_id < 100,000,000
```

`generateId(type)` (`server/utils/idGenerator.js`) ออก id ใหม่ตาม **ช่วงเลขคงที่** ข้างบน
(`MAX(c_id)+1` ภายในช่วง, pad 9 หลัก). type = `group` | `site` | `serial`.

`WebUser.c_id` เป็น **polymorphic FK** → ชี้ `WebGroup.c_id` หรือ `WebSite.c_id`
(ดูวิธี resolve ใน [[auth-and-permissions]]).

## ตารางหลัก (อ้างอิงจาก query ใน `server/index.js`)

> ตารางนี้สรุปจากการใช้งานจริงในโค้ด ไม่ใช่ schema dump — คอลัมน์อาจมีมากกว่าที่ลิสต์.
> เมื่อตรวจ schema จริง ให้ใช้สคริปต์ `server/scripts/inspect_table.js` / `list_tables.js` / `check_columns.js`.

### Auth / Org / Permission
| ตาราง | บทบาท | คอลัมน์เด่น |
|-------|--------|-------------|
| `WebUser` | ผู้ใช้ | `u_id` (GUID PK), `c_id` (FK group/site), `c_type` (role, **เข้ารหัส**), `c_email` |
| `WebGroup` | องค์กร | `c_id`, `c_active` (`'Z'`=Super Group) |
| `WebSite` | ไซต์ | `c_id` |
| `WebMainSub` | ความสัมพันธ์ main↔sub | `main_id`, `main_type`, `sub_id`, `sub_type` |
| `WebSerial` | มิเตอร์/ซีเรียล | `c_id`, `c_serial_id`, `c_name`, `c_machine_id` |
| `WebMenu` | เมนูระบบ | menu id (ตรงกับ `MENU_IDS` ฝั่ง client) |
| `WebPermission` | สิทธิ์รายเมนู | `n_menu`, `c_type`, `n_site`, `c_view/c_insert/c_update/c_delete/c_admin` (`Y`/`N`) |

### Notification
| ตาราง | บทบาท |
|-------|--------|
| `NotifyConfig` | threshold ต่อ `mqtt_serial` + `dbkey` + `level` (point, delay) |
| `NotifyLog` | log เหตุการณ์ alarm (`log_id`, `mqtt_serial`, `dbkey`, `level`, `value`, `point`, `event_time`, `status`, `delivered_count`, `attempts`, `event_type`, `correlation_id`, `c_id`/`owner_type`/`c_name`, **`fail_reason`**) |
| `UserNotificationSubscription` | subscription ของ web push / LINE / smart (channel column). channel `smart` เก็บ `{ gid, pinCipher }` ใน destination แล้วส่งผ่าน relay smarteepro.com (ไม่ต้องมีตาราง pairing) |

### Data / Domain
| ตาราง | บทบาท |
|-------|--------|
| `jobcurrent` | สถานะงาน/เครื่องปัจจุบัน (ใช้ใน `/api/realtime`) |
| `ColQuartery` | ข้อมูลรายคาบ pivot ด้วย `n_column` (7=OEE,8=P,9=A,10=Q), `n_val`, `dt_job_time` |
| `Smartboard` | คอนฟิก smartboard/มิเตอร์ |
| `CarbonCreditConfig` | คอนฟิก carbon credit |
| `DashboardConfig` | คอนฟิก dashboard ต่อ user |
| `CustomViews` | view ที่ผู้ใช้บันทึก/แชร์ (มี public token) |
| `SystemSettings` | ค่าตั้งระบบ |
| `EEGroupHeader` / `EEGroupItem` | การจัดกลุ่มสำหรับ Total/รายงาน |

## ข้อควรระวังเมื่อแก้ schema
- **ไม่มี ORM/migration** — ทุกอย่างเป็น raw SQL. เพิ่มคอลัมน์ = เขียนสคริปต์เองใน `server/scripts/`
  (มีตัวอย่าง `add_description_column.js`, `migrate_alarm_type_to_channels.js`).
- รักษา prefix convention (`c_`/`n_`/`u_`/`dt_`) เมื่อเพิ่มคอลัมน์.
- ระวัง space ต่อท้าย `CHAR` → `.trim()` เสมอ.
