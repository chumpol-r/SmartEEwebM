---
title: ADR 001 — แยก worker เป็น process ต่างหาก
tags: [decision, adr, worker, deployment]
updated: 2026-05-29
sources:
  - server/worker.js
  - ecosystem.config.js
---

# ADR 001 — แยก worker (MQTT/notification) เป็น process ต่างหาก

**สถานะ:** ใช้งานอยู่ (active)

## บริบท
ระบบต้อง subscribe MQTT ตลอดเวลา และส่ง web push / LINE เป็น background loop ยาว ๆ
ขณะเดียวกัน API ฝั่ง dev รันด้วย nodemon (restart บ่อย) และ production host ผ่าน IIS/iisnode.

## ปัญหา
- iisnode รันได้แต่ HTTP — ไม่มีที่ให้ background loop อยู่ยาว.
- restart API ไม่ควรตัดการเชื่อม MQTT หรือขัดการส่ง push ที่ค้างอยู่.
- ต้องการ log stream แยกและ scale/restart อิสระ.

## การตัดสินใจ
แยกออกเป็น `server/worker.js` (process เดียวรวม mqttNotifier + webpushDispatcher +
lineDispatcher) ต่างหากจาก `server/index.js` (HTTP API).
- ทั้งสอง process แชร์ DB ผ่าน `global.dbPool` ของตัวเอง.
- การสื่อสารระหว่างกันคือ **ผ่านตาราง `NotifyLog`** (notifier เขียน, dispatcher อ่าน) ไม่ใช่ IPC.

## ผลที่ตามมา
- Deploy: API = IIS/iisnode; worker = Windows Service (NSSM) หรือ PM2/systemd บน Linux.
- มี escape hatch สำหรับ single-process: `ENABLE_MQTT_WORKER=true` ให้ index.js บูต worker ในตัว
  (อย่ารัน `worker.js` ซ้ำ).
- ต้องตั้ง VAPID env ให้ทั้งสอง process (index ใช้ expose public key, worker ใช้เซ็น push).

ดู flow เต็มที่ [[realtime-and-notifications]].
