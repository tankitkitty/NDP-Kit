# คู่มือการอัปโค้ดขึ้น GitHub และออกเวอร์ชันใหม่ (สำหรับผู้ดูแลระบบ)

เอกสารนี้สำหรับ **ผู้พัฒนา/ผู้ดูแล** ที่แก้โค้ดแล้วต้องการเผยแพร่ขึ้น GitHub เพื่อให้หน่วยบริการทั้งหมดดึง (pull) ไปใช้
(ถ้าคุณเป็นหน่วยบริการที่จะ **ติดตั้งไปใช้งาน** ให้ดู [INSTALL.md](INSTALL.md) แทน)

> **แนวคิดสำคัญ:** หน่วยบริการดึงโค้ดตาม **git tag** (เช่น `v1.0.0`, `v1.1.0`) ไม่ใช่ branch `master`
> ดังนั้นทุกครั้งที่จะปล่อยของใหม่ ต้อง (1) commit → (2) ตั้ง tag เวอร์ชันใหม่ → (3) push ทั้ง commit และ tag

---

## 0. เตรียมครั้งแรกครั้งเดียว

ตรวจว่ามี remote ชี้ไป GitHub แล้ว:

```bash
git remote -v
# ควรเห็น: origin  https://github.com/tankitkitty/13FileTools.git
```

ถ้ายังไม่มี ให้เพิ่ม:

```bash
git remote add origin https://github.com/tankitkitty/13FileTools.git
```

**เรื่อง login GitHub:** ตอน push ครั้งแรก GitHub จะให้ยืนยันตัวตน
- **วิธีง่ายสุด (Windows):** ติดตั้ง [Git for Windows](https://git-scm.com/) ซึ่งมาพร้อม Git Credential Manager — ครั้งแรกจะเด้งหน้าต่างให้ล็อกอิน GitHub ผ่านเบราว์เซอร์ แล้วจำให้อัตโนมัติ
- **หรือใช้ Personal Access Token (PAT):** สร้างที่ GitHub → Settings → Developer settings → Personal access tokens → เลือกสิทธิ์ `repo` แล้วใช้ token นั้นแทนรหัสผ่านตอน push

---

## 1. เช็คลิสต์ก่อนปล่อยเวอร์ชัน (สำคัญมาก)

ทำทุกข้อก่อน commit เสมอ:

```bash
# 1) ตรวจ type ผ่าน
npx tsc --noEmit

# 2) build ผ่าน (จำลองสภาพจริงที่หน่วยบริการจะรัน)
npm run build

# 3) ตรวจว่าไม่มีไฟล์ลับหลุดเข้า git — ต้องไม่เห็นไฟล์เหล่านี้ในผลลัพธ์
git status --short | grep -E 'dbconfig|session-secret|\.env'
#   ถ้าไม่มี output = ปลอดภัย ✓  ถ้ามี = อย่า commit เด็ดขาด
```

ไฟล์ที่ **ห้าม** ขึ้น git (ถูกกันไว้ใน `.gitignore` แล้ว แต่ควรตรวจซ้ำ):
`data/dbconfig.json`, `data/dbconfig43.json`, `data/.session-secret`, `.env.local`, `node_modules/`

---

## 2. ขั้นตอนออกเวอร์ชันใหม่

สมมติเวอร์ชันปัจจุบันคือ `v1.0.0` และเราจะออก `v1.1.0`

```bash
# 1) ดูว่ามีอะไรเปลี่ยนบ้าง
git status

# 2) เพิ่มไฟล์ที่แก้ทั้งหมดเข้า staging
git add -A

# 3) ตรวจซ้ำอีกครั้งว่าไม่มีไฟล์ลับ
git diff --cached --name-only | grep -E 'dbconfig|session-secret|\.env' || echo "ปลอดภัย"

# 4) commit พร้อมข้อความอธิบายว่าทำอะไร
git commit -m "อธิบายสั้นๆ ว่าเวอร์ชันนี้แก้/เพิ่มอะไร"

# 5) ตั้ง tag เวอร์ชันใหม่ (annotated tag)
git tag -a v1.1.0 -m "13File Tools v1.1.0 - สรุปสิ่งที่เปลี่ยน"

# 6) push ทั้ง commit และ tag ขึ้น GitHub
git push origin master
git push origin v1.1.0
```

> ย่อขั้นตอน 6 ให้เหลือคำสั่งเดียว (push commit + tag ทั้งหมดพร้อมกัน):
> ```bash
> git push origin master --tags
> ```

---

## 3. push เวอร์ชันแรก (v1.0.0) ที่ commit ไว้แล้ว

ตอนนี้ในเครื่องมี commit และ tag `v1.0.0` อยู่แล้ว แต่ยังไม่ได้ push ขึ้น GitHub
ปล่อยเวอร์ชันแรกด้วยคำสั่งเดียว:

```bash
git push origin master --tags
```

หลัง push แล้ว เข้าไปดูที่ `https://github.com/tankitkitty/13FileTools/tags` ควรเห็น `v1.0.0`

---

## 4. วิธีตั้งหมายเลขเวอร์ชัน (Semantic Versioning)

รูปแบบ `vMAJOR.MINOR.PATCH` เช่น `v1.2.3`

| ส่วน | เพิ่มเมื่อ | ตัวอย่าง |
| --- | --- | --- |
| **PATCH** (`v1.0.0` → `v1.0.1`) | แก้บั๊กเล็กน้อย ไม่กระทบการใช้งานเดิม | แก้คำผิด, แก้ query พลาด |
| **MINOR** (`v1.0.1` → `v1.1.0`) | เพิ่มฟีเจอร์ใหม่ แต่ของเดิมยังใช้ได้ | เพิ่มเมนู/รายงานใหม่ |
| **MAJOR** (`v1.1.0` → `v2.0.0`) | เปลี่ยนใหญ่ที่หน่วยบริการต้องปรับตาม | เปลี่ยนโครงสร้างฐานข้อมูล, เปลี่ยนวิธีตั้งค่า |

---

## 5. หน่วยบริการอัปเดตยังไง (แจ้งให้ผู้ใช้ทำ)

เมื่อคุณ push เวอร์ชันใหม่แล้ว แจ้งหน่วยบริการให้รันคำสั่งนี้บนเครื่องที่ติดตั้งไว้:

```bash
cd 13FileTools
git fetch --tags
git checkout v1.1.0     # เปลี่ยนเป็นเวอร์ชันใหม่ล่าสุด
npm install             # เผื่อมี dependency ใหม่
npm run build
# แล้ว restart โปรแกรม (npm run start)
```

> ข้อมูลตั้งค่าของแต่ละหน่วย (`data/dbconfig.json`, `.env.local`, `data/.session-secret`)
> อยู่นอก git จึง **ไม่หาย** เวลาอัปเดต — ไม่ต้องตั้งค่าใหม่

---

## 6. ปัญหาที่พบบ่อยตอน push

| อาการ | วิธีแก้ |
| --- | --- |
| `Authentication failed` | ใช้ Personal Access Token แทนรหัสผ่าน (ดูข้อ 0) หรือปล่อยให้ Git Credential Manager เด้งหน้าล็อกอิน |
| `Updates were rejected (fetch first)` | มีคนอื่น/เครื่องอื่น push ไปก่อน — รัน `git pull --rebase origin master` แล้วค่อย push ใหม่ |
| เผลอ commit ไฟล์ลับ (dbconfig/.env) ไปแล้วแต่ยังไม่ push | `git rm --cached <ไฟล์>` แล้ว commit ใหม่ ตรวจว่าไฟล์อยู่ใน `.gitignore` |
| เผลอ push ไฟล์ลับขึ้น GitHub แล้ว | ถือว่ารหัสผ่านนั้น**หลุดแล้ว** ต้องเปลี่ยนรหัสผ่าน DB ทันที และลบไฟล์ออกจากประวัติ git (ปรึกษาก่อนทำ เพราะซับซ้อน) |
