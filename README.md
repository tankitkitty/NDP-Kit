# 13File Tools

เว็บแอปตัวอย่างสำหรับเชื่อมต่อ MySQL และแก้ไขข้อมูลจากฐานข้อมูล

## การติดตั้ง

ดูขั้นตอนติดตั้งแบบละเอียดได้ที่ [INSTALL.md](INSTALL.md)

> **ผู้ดูแล/ผู้พัฒนา:** วิธีอัปโค้ดขึ้น GitHub และออกเวอร์ชันใหม่ให้หน่วยบริการดึงไปใช้ ดูที่ [RELEASE.md](RELEASE.md)

สรุปสั้นๆ:

1. เปิด terminal ในโฟลเดอร์โปรเจกต์
2. รัน `npm install`
3. สร้างไฟล์ `data/dbconfig.json` ถ้าไม่อยู่ (หรือกรอกผ่านหน้า `/settings`)
4. รัน `npm run dev`

## การใช้งาน

- เข้าเว็บที่ `http://localhost:3000` จะถูกพาไปหน้า `เข้าสู่ระบบ` ก่อน
- ล็อกอินด้วย Username/Password ของผู้ใช้งานในตาราง `opduser` (ระบบเทียบกับ `passweb`, บัญชีที่ `account_disable = 'Y'` จะเข้าไม่ได้)
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

## หมายเหตุ

- ไฟล์คอนฟิกฐานข้อมูลถูกเก็บใน `data/dbconfig.json` และ `data/dbconfig43.json` (ไม่ถูก commit เข้า git แล้ว)
- โปรดตรวจสอบว่า MySQL server เข้าถึงได้จากคอนฟิกที่ตั้งไว้
