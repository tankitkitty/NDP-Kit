# รับข้อมูลทะเบียนหน่วยบริการเข้า Google Sheet

เมื่อหน่วยบริการตั้งค่าฐานข้อมูลเสร็จ โปรแกรมจะถามครั้งเดียวว่าต้องการส่งข้อมูล
มาลงทะเบียนไหม ถ้ากดยินยอมจะส่งมาที่ Google Sheet ของเรา

**ข้อมูลที่ส่ง** — มีเท่านี้ ไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคลใดๆ

| ฟิลด์ | ที่มา |
| --- | --- |
| รหัสสถานพยาบาล | `opdconfig.hospitalcode` ใน HOSxP |
| ชื่อสถานพยาบาล | `opdconfig.hospitalname` ใน HOSxP |
| เวอร์ชันที่ใช้ | `version.txt` ในแพ็กเกจ |
| วันเวลาที่ส่ง | เวลาบนเครื่องหน่วยบริการ |

---

## ทำครั้งเดียว: สร้าง Web App ที่รับข้อมูล

Google Sheet รับ POST ตรงๆ ไม่ได้ ต้องมี Apps Script ผูกกับ Sheet แล้ว deploy
เป็น Web App เพื่อให้ได้ URL ปลายทาง

1. เปิด [Google Sheet ปลายทาง](https://docs.google.com/spreadsheets/d/16uXvPZPDOOEU0fKxzq1UJ-Cf-HK2hoIiN7VZ-jkjZas/edit)
2. เมนู **ส่วนขยาย (Extensions)** → **Apps Script**
3. ลบโค้ดเดิมทิ้งทั้งหมด แล้ววางโค้ดด้านล่างลงไป → กดบันทึก
4. กด **ทำให้ใช้งานได้ (Deploy)** → **การทำให้ใช้งานได้ใหม่ (New deployment)**
   - ประเภท: **แอปพลิเคชันเว็บ (Web app)**
   - ดำเนินการในชื่อ (Execute as): **ฉัน (Me)**
   - ผู้มีสิทธิ์เข้าถึง (Who has access): **ทุกคน (Anyone)**

   > ต้องเป็น "ทุกคน" เพราะเครื่องหน่วยบริการไม่ได้ล็อกอินบัญชี Google
   > URL นี้ถูกเรียกจากฝั่งเซิร์ฟเวอร์ของโปรแกรมเท่านั้น ไม่โผล่ในหน้าเว็บให้ผู้ใช้เห็น

5. ครั้งแรก Google จะขออนุญาตเข้าถึง Sheet → กดอนุญาต
   (ถ้าขึ้นเตือน "ยังไม่ได้ยืนยัน" ให้กด ขั้นสูง → ไปที่ ... แบบไม่ปลอดภัย ซึ่งปกติ
   สำหรับสคริปต์ที่เราเขียนเอง)
6. คัดลอก URL ที่ได้ (ลงท้ายด้วย `/exec`) ไปใส่ในไฟล์ `lib/registry.ts`
   ที่ตัวแปร `DEFAULT_REGISTRY_URL`

---

## โค้ดที่ต้องวางใน Apps Script

```javascript
// รับข้อมูลทะเบียนหน่วยบริการจาก NDP Kit แล้วบันทึกลงชีต
// หน่วยบริการเดิมที่ส่งซ้ำจะถูกอัปเดตแถวเดิม ไม่เพิ่มแถวใหม่

const SHEET_NAME = 'ทะเบียนหน่วยบริการ';
const HEADERS = ['วันเวลาที่รับ', 'รหัสสถานพยาบาล', 'ชื่อสถานพยาบาล', 'เวอร์ชัน', 'วันเวลาที่ส่ง'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const code = String(data.hospitalCode || '').trim();
    const row = [new Date(), code, data.hospitalName || '', data.version || '', data.sentAt || ''];

    const sh = getSheet_();

    // หน่วยบริการเดิมส่งมาอีก (เช่น อัปเดตเวอร์ชัน) ให้ทับแถวเดิม
    let updated = false;
    if (code) {
      const values = sh.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][1]).trim() === code) {
          sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
          updated = true;
          break;
        }
      }
    }
    if (!updated) sh.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updated: updated }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## ข้อควรรู้

- **แก้สคริปต์แล้วต้อง deploy ใหม่ทุกครั้ง** ไม่งั้น URL เดิมยังรันโค้ดเก่าอยู่
  (Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → เวอร์ชัน: ใหม่)
- URL ที่เปิดให้ "ทุกคน" เข้าถึงได้ แปลว่าใครที่รู้ URL ก็ยิงข้อมูลปลอมเข้ามาได้
  ข้อมูลชุดนี้ไม่ใช่ความลับและไม่มีผลกับการทำงานของโปรแกรม จึงรับความเสี่ยงนี้ได้
  ถ้าต้องการกัน ให้เพิ่มการตรวจรหัสลับที่ตกลงกันไว้ทั้งสองฝั่ง
- ถ้าเครื่องหน่วยบริการต่ออินเทอร์เน็ตไม่ได้ การส่งจะล้มเหลวอย่างเงียบๆ
  โปรแกรมจะแจ้งผู้ใช้ว่าส่งไม่สำเร็จ และยังใช้งานส่วนอื่นได้ตามปกติ
- ปล่อย `DEFAULT_REGISTRY_URL` ว่างไว้ = ปิดฟีเจอร์นี้ทั้งหมด โปรแกรมจะไม่ถาม
  และไม่ส่งอะไรออกไปเลย
