---
title: Auth & Permissions
tags: [architecture, auth, security, permission]
updated: 2026-05-29
sources:
  - server/index.js:76
  - server/index.js:137
  - server/utils/crypto.js
  - client/src/App.jsx:29
---

# Auth & Permissions

นี่คือส่วนที่ "เซอร์ไพรส์" ที่สุดของระบบ — auth **ไม่ใช่ JWT** และ permission ผูกกับ
ลำดับชั้นองค์กรแบบ multi-tenant. มาจากระบบ ASP/VB เดิม.

## 1) Token (custom, ไม่ใช่ JWT)

Token = `base64( customEncrypt(userId) )` โดย `userId` คือ GUID (`WebUser.u_id`).

- ตอน login (`POST /api/login`, `server/index.js:3086`) เซิร์ฟเวอร์สร้าง token ด้วย
  `EncryptToken(userId)` แล้วส่งกลับ. client เก็บใน `localStorage` (`token`).
- ทุก request แนบ `Authorization: Bearer <token>`.
- `authenticateToken` (`server/index.js:76`) เรียก `DecryptToken(token)` → คืน `userId` → แปะ
  `req.user = { id: userId }`. ถ้าถอดไม่ได้ → 403.

### crypto (`server/utils/crypto.js`)

เป็น **port ตรงจากอัลกอริทึม VB6** (3 ชั้น: salt + shuffle) เพื่อให้เข้ากันได้กับข้อมูลเดิม
ในฐานข้อมูล. คีย์ฝัง hard-code: `ENCODEKEY = "SMARTEE"`, `STR_SAULT = "Q!w2E#r4..."`.
- `Decrypt/Encrypt` — รูปแบบ VB (มี `'` แทนด้วย `<10>`).
- `EncryptToken/DecryptToken` — หุ้ม base64 ทับให้ transport ปลอดภัย (ไม่มีอักขระแปลก).
- ฟิลด์ `WebUser.c_type` (role) ก็ถูก **เข้ารหัสด้วย `Encrypt` เช่นกัน** — ตอนเช็ค permission
  ต้อง `Decrypt(role)` แล้วตัด prefix อีเมลออก (`server/index.js:234`).

> ⚠️ ข้อจำกัดด้านความปลอดภัย: token **ไม่มี expiry / signature แบบ JWT**, คีย์ hard-code,
> และมี `console.log` token/userId หลายจุด. ถือเป็น tech debt ที่รับสืบทอดมา — ดู [[gotchas]].
> เหตุผลที่ยังใช้: ความเข้ากันได้กับข้อมูล/ระบบเดิม — ดู [[002-why-no-jwt]].

## 2) Permission model (Group / Site / Super Group)

โครงสร้างผู้ใช้เป็นแบบ multi-tenant 2 ระดับ (ดูตารางใน [[schema-and-conventions]]):

```
WebGroup (องค์กร, c_id 200,000,000–299,999,999)
   └── WebSite (ไซต์/สาขา, c_id 100,000,000–199,999,999)
WebUser.c_id = polymorphic FK → ชี้ไป WebGroup.c_id *หรือ* WebSite.c_id
```

`WebUser.c_id` เป็น **polymorphic** — ต้องลองหาใน `WebGroup` ก่อน ถ้าไม่เจอค่อยหาใน `WebSite`
(`server/index.js:177`). ถ้าเป็น Site user จะหา parent group ผ่าน `WebMainSub`
(`sub_type='S' AND main_type='G'`).

### `requirePermission(menuId)` (`server/index.js:137`)

middleware factory ที่ทำงานตามขั้น:
1. ยืนยัน token (ทำเองได้ถ้ายังไม่ผ่าน `authenticateToken`).
2. หา `c_type`(role), `c_id`, `c_email` ของ user.
3. ระบุว่า user เป็นระดับ GROUP หรือ SITE และเป็น **Super Group** หรือไม่.
4. **Super Group bypass**: ถ้า `WebGroup.c_active === 'Z'` → ให้สิทธิ์เต็มทุกอย่างทันที
   (`server/index.js:218`). (เช่น องค์กรแม่ "TAT")
5. มิฉะนั้น query `WebPermission` ด้วย `(n_menu, c_type, n_site)` → ได้ flags
   `c_view/c_insert/c_update/c_delete/c_admin` (`Y`/`N`). ไม่มีแถว = **deny by default**.
6. แมป HTTP method → สิทธิ์:
   - `GET` → view, `POST` → insert, `PUT` → update, `DELETE` → delete.
7. แปะผลไว้ที่ `req.userContext` (`userLevel`, `groupId`, `siteId`, `perms`, `isSuperGroup`)
   ให้ handler ใช้ scope การ query ต่อ.

มี helper `getUserScope(req)` (`server/index.js:109`) เวอร์ชันเบากว่า — คืนแค่
`{ cId, isSuperGroup }` ใช้กรอง log ตาม org.

## 3) ฝั่ง client (`client/src/App.jsx`)

- `MENU_IDS` (`client/src/App.jsx:29`) แมป path → menuId ต้องตรงกับ DB เช่น
  `/realtime`=36, `/billing`=37, `/smartboard`=39, `/notify-config`=98, `/notify-log`=99.
- `<ProtectedRoute>` เช็ค token + เรียก `GET /api/user/permissions` ได้ list ของ menuId
  ที่ user เข้าได้ → ถ้า path ปัจจุบันไม่อยู่ใน list → redirect ไป `/access-denied`.
- path ที่ไม่อยู่ใน `MENU_IDS` ถือว่าผ่าน (allow).

## สรุปจุดที่ต้องระวังเมื่อแก้ส่วนนี้

- เพิ่มเมนูใหม่ = ต้องเพิ่มทั้งใน `MENU_IDS` (client) **และ** ตาราง `WebMenu`/`WebPermission` (DB).
- `c_id` ของ user อาจเป็น Group หรือ Site — อย่า assume ว่าเป็นอย่างใดอย่างหนึ่ง.
- การเทียบ id ต้อง `.trim()` เพราะคอลัมน์ `CHAR` ใน SQL Server มี space ต่อท้าย — ดู [[gotchas]].
