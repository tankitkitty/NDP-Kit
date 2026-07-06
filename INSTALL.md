# คู่มือการติดตั้ง 13File Tools

เอกสารนี้อธิบายขั้นตอนติดตั้งและตั้งค่า 13File Tools ตั้งแต่เริ่มต้นจนใช้งานได้จริง

## 1. สิ่งที่ต้องมีก่อน

- **Node.js** เวอร์ชัน 18 ขึ้นไป และ npm (ติดตั้งมาพร้อมกัน)
- **Git**
- สิทธิ์เข้าถึง **MySQL server ของ HOSxP** (ฐานข้อมูลชื่อ `pcu` หรือชื่ออื่นตามที่โรงพยาบาลตั้งไว้) พร้อม user/password ที่มีสิทธิ์อ่าน-เขียนตารางที่เกี่ยวข้อง เช่น `opduser`, `opdconfig`, `eclaim_fee_schedule`
- (ถ้าต้องการใช้ฟีเจอร์ซิงค์สถานะเคลม NHSO) ข้อมูลเชื่อมต่อ NHSO Digital Platform จาก สปสช.

## 2. ดาวน์โหลดโค้ด

```bash
git clone https://github.com/tankitkitty/13FileTools.git
cd 13FileTools
```

## 3. ติดตั้ง dependencies

```bash
npm install
```

## 4. ตั้งค่าฐานข้อมูล (`data/dbconfig.json`)

ไฟล์นี้เก็บข้อมูลเชื่อมต่อ MySQL และ **ไม่ถูก commit เข้า git** (มีอยู่ใน `.gitignore` แล้ว) เพราะมีรหัสผ่านฐานข้อมูลอยู่ในนั้น

สร้างไฟล์ `data/dbconfig.json` เอง (ถ้ายังไม่มี) โดยใช้รูปแบบนี้:

```json
{
  "host": "localhost",
  "port": 3306,
  "user": "sa",
  "password": "รหัสผ่านจริง",
  "database": "pcu"
}
```

> ไม่จำเป็นต้องสร้างไฟล์นี้ด้วยมือก็ได้ — เปิดแอปขึ้นมาแล้วเข้าไปที่หน้า `/settings` (เข้าได้โดยไม่ต้อง login) กรอกข้อมูลแล้วกด **Save Config** ระบบจะสร้างไฟล์นี้ให้อัตโนมัติ

## 5. ตั้งค่า `.env.local`

สร้างไฟล์ `.env.local` ที่ root ของโปรเจกต์ (ไฟล์นี้ก็ไม่ถูก commit เข้า git เช่นกัน):

```env
# จำเป็นสำหรับ production (ตอน dev ไม่ตั้งก็รันได้ แต่จะใช้ค่า default ที่ไม่ปลอดภัย)
SESSION_SECRET=สุ่มข้อความยาวๆ-ที่คาดเดายาก

# จำเป็นเฉพาะถ้าต้องการใช้ปุ่ม "ซิงค์สถานะจาก NHSO" ในหน้า eClaim Fee Schedule
NHSO_ENV=uat
NHSO_CLIENT_ID=รหัสสถานพยาบาล (hospital code)
NHSO_CLIENT_SECRET=Token จากระบบ New AuthenCode (Token Mobile)
NHSO_SOURCE_ID=HOS
NHSO_SOURCE_ID_KEY=ค่าลับสำหรับ header x-sourceid-key
NHSO_FDH_KEY=ค่าลับสำหรับ header x-fdh-key (optional)
NHSO_PUBLIC_KEY_PATH=./nhso-public-key.pem
```

**ข้อควรระวัง: ห้าม commit ไฟล์ `.env.local` หรือค่าจริงข้างในเข้า git โดยเด็ดขาด**

รายละเอียดตัวแปร NHSO ทั้งหมดดูเพิ่มเติมได้ที่ [README.md](README.md#การเชื่อมต่อ-nhso-digital-platform-ซิงค์สถานะเคลม)

## 6. รันโปรแกรม

โหมดพัฒนา (dev):

```bash
npm run dev
```

จากนั้นเปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

โหมด production:

```bash
npm run build
npm run start
```

## 7. เข้าสู่ระบบครั้งแรก

- เข้าเว็บแอปจะพาไปหน้า `เข้าสู่ระบบ` ก่อนเสมอ
- ล็อกอินด้วย **Username / Password ของผู้ใช้งานในตาราง `opduser`** ของฐานข้อมูล HOSxP ที่ตั้งค่าไว้ในขั้นตอนที่ 4 (ระบบเทียบรหัสผ่านกับคอลัมน์ `passweb`)
- บัญชีที่ถูกตั้ง `account_disable = 'Y'` จะเข้าระบบไม่ได้

## 8. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
| --- | --- | --- |
| เข้าเว็บแล้ว error เชื่อมต่อฐานข้อมูลไม่ได้ | ค่าใน `data/dbconfig.json` ผิด หรือ MySQL server เข้าไม่ถึง | ไปที่หน้า `/settings` แก้ไขค่าแล้วกด **Test Connection** |
| ล็อกอินไม่ได้ทั้งที่ username/password ถูก | บัญชีถูกปิด (`account_disable='Y'`) หรือฐานข้อมูลที่เชื่อมต่ออยู่ไม่ใช่ฐานที่มีบัญชีนี้ | ตรวจสอบชื่อฐานข้อมูล (`database`) ในหน้า `/settings` ว่าตรงกับที่ต้องการ |
| กดปุ่ม "ซิงค์สถานะจาก NHSO" แล้วขึ้น error ว่าตัวแปรขาดหาย | ยังไม่ได้ตั้งค่า `NHSO_*` ใน `.env.local` | ตั้งค่าตัวแปรตามขั้นตอนที่ 5 แล้ว restart เซิร์ฟเวอร์ |
| แก้ `.env.local` หรือ `data/dbconfig.json` แล้วแอปยังใช้ค่าเดิม | ต้อง restart dev server เพื่อให้อ่านค่าใหม่ (`.env.local` เท่านั้น — `dbconfig.json` อ่านใหม่ทุกครั้งอัตโนมัติ) | หยุดแล้วรัน `npm run dev` ใหม่ |

## 9. หมายเหตุด้านความปลอดภัย

- อย่า commit `data/dbconfig.json` และ `.env.local` เข้า git (ถูกกันไว้ใน `.gitignore` แล้ว แต่ควรตรวจสอบทุกครั้งก่อน commit)
- ตั้งค่า `SESSION_SECRET` ก่อน deploy ขึ้น production เสมอ
- ฐานข้อมูลที่เชื่อมต่อเป็นฐานข้อมูลจริงของโรงพยาบาล (มีข้อมูลผู้ป่วย) ควรจำกัดสิทธิ์เข้าถึงเซิร์ฟเวอร์ที่รันแอปนี้ให้เหมาะสม
