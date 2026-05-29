---
title: Architecture Overview
tags: [architecture, overview]
updated: 2026-05-29
sources:
  - server/index.js
  - server/worker.js
  - client/src/App.jsx
  - ecosystem.config.js
---

# Architecture Overview

SmartEE Web เป็นระบบ monitoring พลังงาน/OEE แบบ multi-tenant (หลายองค์กร) ที่
**port มาจากระบบ ASP/VB เดิม** (`*.aspx.vb`) มาเป็น Node + React. ร่องรอยของระบบเดิม
ยังเห็นได้ทั่วโค้ด (custom crypto, ชื่อตารางแบบ legacy, logic ที่ comment อ้าง `.aspx.vb`).

## ภาพรวม 3 ส่วน

```
┌─────────────┐     HTTP/REST      ┌──────────────────┐      ODBC       ┌──────────────┐
│  client/    │ ──────────────────▶│   server/        │ ───────────────▶│  SQL Server  │
│ React 18 SPA│  Bearer token      │  index.js (API)  │  msnodesqlv8    │ db_energy_   │
│  Vite 7     │◀────────────────── │  Express 4       │◀─────────────── │  oee_dev     │
└──────┬──────┘                    └──────────────────┘                 └──────┬───────┘
       │                                                                       │
       │  MQTT over WebSocket                  ┌──────────────────┐            │
       └──────────────────────────────────────│  worker.js       │────────────┘
          (client subscribes live data)        │  (process แยก)   │  เขียน NotifyLog
                                                │  MQTT notifier + │
          web push / LINE push ◀──────────────  │  dispatchers     │
                                                └──────────────────┘
```

| ส่วน | เทคโนโลยี | จุดเริ่ม |
|------|-----------|----------|
| **client** | React 18, Vite 7, Tailwind 4, react-router-dom 7, axios, mqtt.js, recharts, reactflow, xlsx | `client/src/main.jsx` → `App.jsx` |
| **server (API)** | Express 4 (ESM=ไม่ใช่, CommonJS `require`), `mssql/msnodesqlv8` | `server/index.js` |
| **worker** | Node process แยก: MQTT notifier + web push + LINE dispatcher | `server/worker.js` |
| **DB** | Microsoft SQL Server (ODBC Driver 17) | ดู [[schema-and-conventions]] |

> ⚠️ stack นี้คือ **SQL Server + Express 4 + custom token** — ไม่ใช่ TimescaleDB/JWT/monorepo
> ตามที่ `CLAUDE.md` ที่ root อธิบาย (นั่นเป็นของโปรเจกต์อื่น). ดู [[002-why-no-jwt]].

## API server (`server/index.js`)

- เป็น **monolith ก้อนเดียว ~6,350 บรรทัด** — ทุก route นิยามตรง ๆ ด้วย `app.get/post/put/delete`
  ไม่มีการแยก controller/service/repository. SQL เขียน inline ในแต่ละ handler.
- **DB pool เป็น singleton ระดับ global**: middleware ที่ `server/index.js:60` สร้าง `global.dbPool`
  ครั้งแรกที่มี request แล้วแปะให้เป็น `req.db` ทุก request ถัดไป.
- Body limit = **50 MB** และเก็บ `req.rawBody` ไว้ให้ LINE webhook ตรวจ HMAC (`server/index.js:43`).
- Health check ไม่ต้อง auth: `GET /api/health` (`server/index.js:49`).
- Port มาจาก `PORT` (default 3002) + ฟังเพิ่มที่ `EXTRA_PORTS` (default 3003) — `server/index.js:9`.

### Auth & Permission (สำคัญ — ไม่ตรงสามัญสำนึก)

ระบบ auth **ไม่ใช่ JWT** และ permission ผูกกับลำดับชั้น Group/Site. รายละเอียดเต็มอยู่ที่
[[auth-and-permissions]]. สรุป:
- `authenticateToken` (`server/index.js:76`) ถอด token → ได้ `userId` (GUID) แปะ `req.user`.
- `requirePermission(menuId)` (`server/index.js:137`) เช็คสิทธิ์รายเมนูจากตาราง `WebPermission`.

## Worker process (`server/worker.js`)

แยกจาก API โดยตั้งใจ เพราะ:
- restart API (nodemon) ไม่ควรตัด MQTT หรือขัดจังหวะการส่ง push ที่ค้างอยู่.
- IIS/iisnode รันได้แต่ HTTP — ไม่มีที่ให้รัน background loop ยาว ๆ.

worker รัน 3 อย่าง (`server/worker.js:50`):
1. **mqttNotifier** — subscribe MQTT, เทียบ threshold, insert `NotifyLog`.
2. **webpushDispatcher** — อ่านแถว pending ใน `NotifyLog` ส่ง Web Push (VAPID).
3. **lineDispatcher** — ส่งเข้า LINE Messaging API ต่อ subscription.

ดู flow เต็มที่ [[realtime-and-notifications]].

## client SPA (`client/src/App.jsx`)

- Routing ด้วย react-router-dom 7. ทุกหน้าหุ้มด้วย `<ProtectedRoute>` ที่เช็ค token ใน
  `localStorage` + เรียก `/api/user/permissions` เทียบกับ `MENU_IDS` map (`client/src/App.jsx:29`).
- Provider ซ้อนกัน: `ConfigProvider` → `ToastProvider` → `MQTTProvider` → `Router`.
- หน้า public (ไม่ต้องล็อกอิน): `/login`, `/scan`, `/access-denied`.
- หน้า realtime ใช้ MQTT live data ผ่าน `MQTTContext` (`client/src/contexts/MQTTContext.jsx`).

## Deployment

- กำหนดใน `ecosystem.config.js` (PM2, fork mode, 1 instance — เหมาะกับ Windows + IIS).
- env: development=PORT 3003, staging/production=PORT 3002.
- บน Windows Server: API host ผ่าน **IIS + iisnode** (`server/web.config`), worker รันเป็น
  **Windows Service** (NSSM) แยก. บน Linux ใช้ PM2/systemd. ดู `server/worker.js:10`.

## ที่มาของข้อมูล realtime

`GET /api/realtime` (`server/index.js:1018`) **อ่านจาก SQL Server** (ตาราง `jobcurrent` +
`ColQuartery` pivot คอลัมน์ OEE/P/A/Q) ไม่ได้ต่อ OPC/Modbus สด — logic port มาจาก
`Realtime.aspx.vb`. ส่วน MQTT ใช้สำหรับ live stream + การแจ้งเตือนเท่านั้น.
