# คู่มือการติดตั้ง 13File Tools

เอกสารนี้อธิบายขั้นตอนติดตั้งและตั้งค่า 13File Tools ตั้งแต่เริ่มต้นจนใช้งานได้จริง

## 1. สิ่งที่ต้องมีก่อน

- **Node.js** เวอร์ชัน 18 ขึ้นไป และ npm (ติดตั้งมาพร้อมกัน)
- **Git**
- สิทธิ์เข้าถึง **MySQL server ของ HOSxP PCU** (ฐานข้อมูลชื่อ `pcu` หรือชื่ออื่นตามที่โรงพยาบาลตั้งไว้) พร้อม user/password ที่มีสิทธิ์อ่าน-เขียนตารางที่เกี่ยวข้อง เช่น `officer`, `opdconfig`, `eclaim_fee_schedule`
- (ถ้าต้องการใช้ฟีเจอร์ซิงค์สถานะเคลม NHSO) ข้อมูลเชื่อมต่อ NHSO Digital Platform จาก สปสช.

## 2. ดาวน์โหลดโค้ด

โคลนโปรเจกต์ แล้ว **checkout ไปที่เวอร์ชัน release ล่าสุด** (ไม่ควรใช้ branch `master` ตรง ๆ เพราะอาจมีโค้ดที่กำลังพัฒนาค้างอยู่):

```bash
git clone https://github.com/tankitkitty/13FileTools.git
cd 13FileTools
git fetch --tags
git checkout v1.0.0     # ใช้ tag ล่าสุด — ดูรายการด้วย: git tag -l
```

เมื่อมีเวอร์ชันใหม่ อัปเดตด้วย:

```bash
git fetch --tags
git checkout <tag ใหม่>
npm install
npm run build
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

> ไม่จำเป็นต้องสร้างไฟล์นี้ด้วยมือก็ได้ — เปิดแอปขึ้นมาแล้วเข้าไปที่หน้า `/settings` กรอกข้อมูลแล้วกด **Save Config** ระบบจะสร้างไฟล์นี้ให้อัตโนมัติ
>
> **หมายเหตุด้านความปลอดภัย:** หน้า `/settings` และ API ตั้งค่าฐานข้อมูลจะ **เปิดให้เข้าถึงได้โดยไม่ต้อง login เฉพาะช่วงติดตั้งครั้งแรก** (ตอนที่ยังไม่มีไฟล์ `data/dbconfig.json`) เมื่อบันทึกค่าเชื่อมต่อครั้งแรกเสร็จแล้ว การเข้าหน้านี้และการแก้ไขค่าเชื่อมต่อทั้งหมดจะ **ต้อง login ก่อนเสมอ** ดังนั้นควรตั้งค่า DB และทดลอง login ให้เรียบร้อยทันทีหลังติดตั้ง

## 5. ตั้งค่า `.env.local`

สร้างไฟล์ `.env.local` ที่ root ของโปรเจกต์ (ไฟล์นี้ก็ไม่ถูก commit เข้า git เช่นกัน):

```env
# ไม่บังคับ — ถ้าไม่ตั้ง ระบบจะสร้าง secret สุ่มเฉพาะเครื่องเก็บไว้ที่
# data/.session-secret ให้อัตโนมัติ (ปลอดภัยและไม่ซ้ำกันในแต่ละหน่วย)
# ตั้งค่านี้เฉพาะเมื่อรันหลายเครื่อง/หลาย instance ที่ต้องแชร์ session กัน
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

**สำหรับการใช้งานจริงในหน่วยบริการ ให้รันโหมด production เสมอ** (เร็วกว่าและปลอดภัยกว่า dev):

```bash
npm run build
npm run start
```

จากนั้นเปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

> โหมดพัฒนา (`npm run dev`) ใช้สำหรับทดสอบ/แก้โค้ดเท่านั้น ไม่ควรใช้รันงานจริง

## 7. เข้าสู่ระบบครั้งแรก

- เข้าเว็บแอปจะพาไปหน้า `เข้าสู่ระบบ` ก่อนเสมอ
- ล็อกอินด้วย **Username / Password ของเจ้าหน้าที่ในตาราง `officer`** ของฐานข้อมูล HOSxP PCU ที่ตั้งค่าไว้ในขั้นตอนที่ 4 (ระบบเทียบชื่อผู้ใช้กับ `officer_login_name` และรหัสผ่านกับ `officer_login_password_md5` = MD5 ของรหัสผ่าน)
- บัญชีที่ตั้ง `officer_active = 'N'` จะเข้าระบบไม่ได้
- ผู้ใช้ที่ **ยังไม่เคยตั้งรหัสผ่านฝั่งเว็บ** (`officer_login_password_md5` ว่าง) จะเข้าไม่ได้ ต้องตั้งรหัสผ่านในโปรแกรม HOSxP PCU ก่อน หรือใช้ `UPDATE officer SET officer_login_password_md5 = MD5('รหัส') WHERE officer_login_name='...'`

## 8. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
| --- | --- | --- |
| เข้าเว็บแล้ว error เชื่อมต่อฐานข้อมูลไม่ได้ | ค่าใน `data/dbconfig.json` ผิด หรือ MySQL server เข้าไม่ถึง | ไปที่หน้า `/settings` แก้ไขค่าแล้วกด **Test Connection** |
| ล็อกอินไม่ได้ทั้งที่ username/password ถูก | ยังไม่ได้ตั้งรหัสผ่านฝั่งเว็บ (`officer_login_password_md5` ว่าง), บัญชีถูกปิด (`officer_active='N'`), หรือเชื่อมต่อผิดฐาน | รัน `SELECT officer_login_name, officer_login_password_md5, officer_active FROM officer WHERE officer_login_name='ชื่อ'` เพื่อตรวจ และตรวจชื่อฐานข้อมูลในหน้า `/settings` |
| กดปุ่ม "ซิงค์สถานะจาก NHSO" แล้วขึ้น error ว่าตัวแปรขาดหาย | ยังไม่ได้ตั้งค่า `NHSO_*` ใน `.env.local` | ตั้งค่าตัวแปรตามขั้นตอนที่ 5 แล้ว restart เซิร์ฟเวอร์ |
| แก้ `.env.local` หรือ `data/dbconfig.json` แล้วแอปยังใช้ค่าเดิม | ต้อง restart dev server เพื่อให้อ่านค่าใหม่ (`.env.local` เท่านั้น — `dbconfig.json` อ่านใหม่ทุกครั้งอัตโนมัติ) | หยุดแล้วรัน `npm run dev` ใหม่ |

## 9. ระบบตรวจสอบสิทธิ (NHSO Secure SmartCard Agent)

หน้า **ตรวจสอบสิทธิ** เรียกใช้งานผ่าน NHSO Secure SmartCard Agent ที่ต้องติดตั้งบน **เครื่องที่เปิดหน้านี้** (ไม่ใช่ที่เซิร์ฟเวอร์):

1. ขอ **TOKEN** ของหน่วยบริการจาก สปสช.
2. ติดตั้ง Agent ตามคู่มือของ สปสช. ใส่ TOKEN ใน `userconfig.properties` แล้วรัน `install.bat` (Run as Administrator)
3. ทดสอบว่าเปิด `http://localhost:8189` แล้วเห็นหน้า Agent
4. ดึงข้อมูลผู้ป่วย OPD จากตาราง `ovst`/`patient` ของ HOSxP PCU ตามช่วงวันที่ แล้วเลือกส่งตรวจสอบสิทธิ ระบบจะเว้นระยะอย่างน้อย 5 วินาที/รายการ และไม่เกิน 3,000 ครั้ง/วัน โดยอัตโนมัติ

## 10. หมายเหตุด้านความปลอดภัย

- อย่า commit `data/dbconfig.json`, `data/dbconfig43.json`, `data/.session-secret` และ `.env.local` เข้า git (ถูกกันไว้ใน `.gitignore` แล้ว แต่ควรตรวจสอบทุกครั้งก่อน commit)
- หน้า `/settings` และ API ตั้งค่า/ทดสอบการเชื่อมต่อ จะเปิดโดยไม่ต้อง login **เฉพาะช่วงติดตั้งครั้งแรก** เท่านั้น หลังตั้งค่า DB เสร็จจะบังคับ login — ควรตั้งค่าให้เสร็จทันทีหลังติดตั้ง
- session secret ถูกสร้างสุ่มเฉพาะเครื่องอัตโนมัติ (`data/.session-secret`) ถ้าไม่ได้ตั้ง `SESSION_SECRET`
- หน้า login มีการจำกัดจำนวนครั้งที่ลองผิด (10 ครั้ง/IP ต่อ 15 นาที) เพื่อกันการเดารหัสผ่าน
- ฐานข้อมูลที่เชื่อมต่อเป็นฐานข้อมูลจริงของโรงพยาบาล (มีข้อมูลผู้ป่วย) ควรจำกัดสิทธิ์เข้าถึงเซิร์ฟเวอร์ที่รันแอปนี้ให้เหมาะสม และควรรันแอปนี้เฉพาะในเครือข่ายภายในของหน่วยบริการ
