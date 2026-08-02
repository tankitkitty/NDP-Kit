# 13File Tools

เว็บแอปตัวอย่างสำหรับเชื่อมต่อ MySQL และแก้ไขข้อมูลจากฐานข้อมูล

## การติดตั้ง

ดูขั้นตอนติดตั้งแบบละเอียดได้ที่ [INSTALL.md](INSTALL.md)

> **ผู้ดูแล/ผู้พัฒนา:** วิธีอัปโค้ดขึ้น GitHub และออกเวอร์ชันใหม่ให้หน่วยบริการดึงไปใช้ ดูที่ [RELEASE.md](RELEASE.md)

สรุปสั้นๆ — **วิธีที่แนะนำ (Docker):** วางไฟล์ `docker-compose.yml` ไว้ในโฟลเดอร์ว่าง แล้วรัน

```bash
docker compose up -d          # ติดตั้ง/เปิดใช้งาน
docker compose pull && docker compose up -d   # อัปเดตเวอร์ชันใหม่
```

ค่าตั้งทั้งหมดเก็บใน `./data` (volume) จึงไม่หายเวลาอัปเดต

หรือแบบดั้งเดิม (ต้องมี Node.js):

1. เปิด terminal ในโฟลเดอร์โปรเจกต์
2. รัน `npm install`
3. สร้างไฟล์ `data/dbconfig.json` ถ้าไม่อยู่ (หรือกรอกผ่านหน้า `/settings`)
4. รัน `npm run dev`

## การใช้งาน

- เข้าเว็บที่ `http://localhost:3000` จะถูกพาไปหน้า `เข้าสู่ระบบ` ก่อน
- ล็อกอินด้วย Username/Password ของเจ้าหน้าที่ในตาราง `officer` ของ HOSxP PCU (เทียบ `officer_login_name` กับ `officer_login_password_md5` = MD5 ของรหัสผ่าน, บัญชีที่ `officer_active = 'N'` จะเข้าไม่ได้)
- หลังล็อกอินแล้ว ไปที่ `ตั้งค่าการเชื่อมต่อ` เพื่อตั้งค่าฐานข้อมูล MySQL, กด `Save Config` แล้ว `Test Connection`
- ในหน้าเดียวกันมีส่วน `ตั้งค่าฐานข้อมูล 43 แฟ้ม` สำหรับตั้งค่าการเชื่อมต่อฐานข้อมูล 43 แฟ้มแยกต่างหาก (เก็บไว้ที่ `data/dbconfig43.json`)
- กลับหน้าหลักเพื่อเพิ่ม / แก้ไขข้อมูลในตาราง `items`

## ความปลอดภัย

- ทุกหน้าและทุก API ต้องมี session cookie ที่ผ่านการเข้าสู่ระบบ ยกเว้น `/login`, `/api/login` และหน้า/API ตั้งค่าฐานข้อมูลที่เปิดได้เฉพาะ **ช่วงติดตั้งครั้งแรก** (ตอนยังไม่มี `data/dbconfig.json`) — เมื่อตั้งค่าเสร็จจะบังคับ login ทั้งหมด
- `SESSION_SECRET` ไม่บังคับตั้ง — ถ้าไม่ตั้งระบบจะสร้าง secret สุ่มเฉพาะเครื่องเก็บที่ `data/.session-secret` ให้อัตโนมัติ (ตั้งเองเฉพาะเมื่อรันหลาย instance ที่ต้องแชร์ session)
- หน้า login จำกัดจำนวนครั้งที่ลองผิด 10 ครั้ง/IP ต่อ 15 นาที กันการเดารหัสผ่าน
- session cookie เป็น HttpOnly + SameSite=Lax และหมดอายุใน 8 ชั่วโมง

## การเชื่อมต่อ NHSO Digital Platform (ซิงค์สถานะเคลม)

หน้า `/eclaim-fee-schedule` มีปุ่ม "ซิงค์สถานะจาก NHSO" ที่ดึงสถานะล่าสุดจาก NHSO Digital Platform API
(`status-tracks/details`) มาอัปเดตคอลัมน์ `nhso_record_status`, `nhso_message`, `nhso_run_date` ฯลฯ ในตาราง
`eclaim_fee_schedule` โดยจับคู่ผ่านคอลัมน์ `nhso_uid`

ต้องตั้งค่าตัวแปรต่อไปนี้ใน `.env.local` ก่อนใช้งาน (ค่าจริงขอได้จาก สปสช. — ห้าม commit ค่าจริงเข้า git):

- `NHSO_ENV` — `uat` หรือ `production` (ค่าเริ่มต้น `uat`)
- `NHSO_CLIENT_ID` — รหัสสถานพยาบาล (hospital code)
- `NHSO_CLIENT_SECRET` — Token จากระบบ New AuthenCode (Token Mobile)
- `NHSO_SOURCE_ID` — vendor source id (เช่น `HOS`)
- `NHSO_SOURCE_ID_KEY` — ค่าลับสำหรับเข้ารหัสเป็น header `x-sourceid-key`
- `NHSO_FDH_KEY` — (optional) ค่าลับสำหรับเข้ารหัสเป็น header `x-fdh-key` กรณีใช้งานผ่านช่องทาง fdh
- `NHSO_PUBLIC_KEY` (PEM string, ใช้ `\n` แทนขึ้นบรรทัดใหม่) หรือ `NHSO_PUBLIC_KEY_PATH` (path ไปยังไฟล์ PEM) —
  public key ของ NHSO DP สำหรับเข้ารหัส RSA-OAEP (SHA-256)

ถ้าไม่ตั้งค่าตัวแปรเหล่านี้ ปุ่มซิงค์จะแสดง error ที่ระบุตัวแปรที่ขาดหายไป แต่จะไม่ทำให้แอปพัง

## ตรวจความพร้อมก่อนส่งเคลม 13 แฟ้มเข้า NDP (`/ndp-precheck`)

Dashboard "การ์ดตรวจสอบ" สำหรับตรวจข้อมูลในฐาน HOSxP ให้ครบเงื่อนไขก่อนส่งเคลม 13 แฟ้ม ลดปัญหาเคลมตีกลับ:

1. เลขบัตรผู้พิการ (`person_deformed.deformed_no`) ตรงกับ `person.cid` (ไม่มีขีด) — แก้อัตโนมัติได้ผ่านปุ่มยืนยัน
2. รหัสไปรษณีย์ผู้ป่วย (`patient.po_code`) เป็นตัวเลข 5 หลัก
3. ข้อมูลบุคลากร (ตาราง `doctor`): เลขใบประกอบวิชาชีพ, เลขบัตร ปชช., provider_type, รหัสสภาวิชาชีพ 01-07 + เทียบ `doctor_position` กับ `doctor_position_std`
4. การตั้งค่าสิทธิการรักษา (`pttype`): noexpire / export_eclaim / is_pttype_plan / default_request_funds / paidst='02' / pttype_price_group_id (1=OFC/LGO, 2=UC/WEL)
5. Token ส่งแฟ้ม: `sys_var` (`%token%`) มีค่า และ `nhso_token` ยังไม่หมดอายุ
6. รหัสยา (`drugitems.sks_drug_code`/ราคา/หมวด income) เทียบ `drug_catalog_import_detail` รายการล่าสุดตาม dateeffective
7. ราคาที่คีย์จริง (`opitemrece.unitprice`) เทียบราคาตั้งต้น (`drugitems.unitprice`) ตามช่วงวันที่ที่เลือก
8. Checklist รหัสบริการคัดกรองที่ NDP กำหนด (ติ๊กเอง เก็บใน localStorage เพราะรหัสแต่ละหน่วยต่างกัน)
9. เคสในช่วงวันที่ที่ยังไม่มีเลขปิดสิทธิ (`visit_pttype.auth_code` ว่าง)
10. ประวัติการส่งเคลมล่าสุด — ค้นหาตาราง log (`%ndp%`, `%eclaim%`, `%claim%log%` ฯลฯ) จาก `information_schema` อัตโนมัติ แล้วพรีวิวรายการล่าสุดพร้อมคอลัมน์ error/status

จุดสำคัญด้านความปลอดภัยของหน้านี้:

- ทุก query ตรวจสอบวิ่งผ่าน `lib/precheck/readonly.ts` ที่ยอมรับเฉพาะ `SELECT` คำสั่งเดียว (บล็อก UPDATE/DELETE, multi-statement, INTO OUTFILE)
- คำสั่งแก้ไข (UPDATE) แสดงให้ **copy ไปรันเอง** ใน SQL Query ของ HOSxP — ระบบไม่รันให้อัตโนมัติ
- หัวข้อที่แก้อัตโนมัติได้ (ข้อ 1) ต้องกดปุ่มยืนยันใน modal ที่เตือนเรื่อง MyISAM/สำรองข้อมูลก่อน และ API (`/api/precheck/fix`) รับแค่ `checkId` — ไม่รับ SQL จาก client
- แนะนำใช้ MySQL user แบบ SELECT-only (ดู `.env.example`) — ปุ่มรันแก้ไขจะ fail อย่างปลอดภัยและแนะนำให้ copy แทน
- HOSxP แต่ละรุ่นมีคอลัมน์ไม่เท่ากัน — check ที่เสี่ยงจะสำรวจคอลัมน์จริงจาก `information_schema` ก่อนประกอบ query และรายงาน "ตรวจไม่ได้" แทนที่จะพัง

หน้า `/setup-checklist` เป็นขั้นตอนตั้งค่าเริ่มต้นแบบ step-by-step (11 ขั้น ตั้งแต่เลขผู้พิการจนถึงส่งเคลม) ติ๊กแล้วเก็บสถานะใน localStorage ของเครื่องนั้น เหมาะสำหรับเจ้าหน้าที่ใหม่

โค้ดฝั่ง server แยกไฟล์ตามหัวข้อที่ `lib/precheck/checks/*.ts` — เพิ่มหัวข้อใหม่ได้โดยเขียนไฟล์ใหม่แล้วลงทะเบียนใน `lib/precheck/index.ts` และเพิ่ม meta ใน `pages/ndp-precheck.tsx`

## หมายเหตุ

- ไฟล์คอนฟิกฐานข้อมูลถูกเก็บใน `data/dbconfig.json` และ `data/dbconfig43.json` (ไม่ถูก commit เข้า git แล้ว)
- โปรดตรวจสอบว่า MySQL server เข้าถึงได้จากคอนฟิกที่ตั้งไว้
