---
title: ADR 002 — ใช้ custom token (VB-compatible) แทน JWT
tags: [decision, adr, auth, security, legacy]
updated: 2026-05-29
sources:
  - server/utils/crypto.js
  - server/index.js:76
  - server/index.js:3086
---

# ADR 002 — ใช้ custom token (VB-compatible) แทน JWT

**สถานะ:** ใช้งานอยู่ (active) — เป็น tech debt ที่รับสืบทอด

## บริบท
SmartEE Web port มาจากระบบ ASP/VB เดิมที่มีฐานข้อมูลผู้ใช้และ role ที่ **เข้ารหัสด้วย
อัลกอริทึม VB6 เฉพาะตัว** อยู่แล้ว (ฟิลด์ `WebUser.c_type` เก็บ role แบบเข้ารหัส).

## การตัดสินใจ
คง crypto เดิมไว้ (`server/utils/crypto.js` = port ของ VB6: salt + shuffle 3 ชั้น) และทำ
token เป็น `base64(Encrypt(userId))` แทนที่จะเปลี่ยนไป JWT.

**เหตุผล:** ถ้าเปลี่ยนไป JWT ต้อง re-encrypt/migrate ข้อมูล role และ credential เดิมทั้งหมด
ซึ่งเสี่ยงและกระทบ integration อื่นที่ยังอ่านรูปแบบเดิม.

## ผลที่ตามมา / ข้อจำกัด (สำคัญ)
- token **ไม่มี expiry และไม่มี signature** แบบ JWT — ถอดได้คือถือว่า valid.
- คีย์ (`ENCODEKEY`, `STR_SAULT`) **hard-code ในซอร์ส**.
- มี `console.log` token / userId หลายจุด (`server/index.js:78,86,90`).
- ไม่มี refresh-token flow; client เก็บ token ใน `localStorage`.

> ⚠️ ถ้าจะ harden ในอนาคต: พิจารณาออก JWT คู่ขนาน (เก็บ mapping ไป userId เดิม),
> ย้ายคีย์ไป env, และลบ log ที่พ่น token. แต่ต้องไม่ทำลายความเข้ากันได้กับข้อมูล role เดิม.

ดูรายละเอียดกลไกที่ [[auth-and-permissions]] · กับดักที่ [[gotchas]].
