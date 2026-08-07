/**
 * NDP-Kit — ตัวรับคำขอสร้างรายงานจากผู้ช่วย แล้วเขียนเป็นไฟล์ลง Google Drive
 *
 * มีไว้เพราะตัวโปรแกรมเขียนไฟล์ลง Drive เองไม่ได้ ต้องมี credential ที่เขียนได้
 * ซึ่งเราไม่อยากเก็บไว้ในเครื่องผู้ช่วย สคริปต์นี้ทำงานด้วยสิทธิ์ของเจ้าของสคริปต์
 * ฝั่งผู้ช่วยจึงส่งได้โดยไม่มีรหัสอะไรอยู่ในเครื่องเลย
 *
 * ==========================  วิธีติดตั้ง (ทำครั้งเดียว)  ==========================
 *
 * 1. เปิด https://script.google.com แล้วสร้างโปรเจ็คใหม่
 * 2. วางไฟล์นี้ทั้งไฟล์ลงไป
 * 3. แก้ INBOX_FOLDER_ID ให้เป็นรหัสโฟลเดอร์ที่จะเก็บคำขอ
 * 4. แก้ SHARED_TOKEN เป็นข้อความสุ่มยาวๆ ของคุณเอง แล้วเอาค่าเดียวกันไปใส่ใน
 *    lib/reports/submit.ts ฝั่งโปรแกรม
 * 5. Deploy > New deployment > ชนิด Web app
 *      Execute as        : Me
 *      Who has access    : Anyone
 *    (ต้องเป็น Anyone เพราะเครื่องผู้ช่วยไม่ได้ล็อกอิน Google)
 * 6. ก๊อป URL ที่ได้ (ลงท้าย /exec) ไปใส่ใน lib/reports/submit.ts
 *
 * ทุกครั้งที่แก้สคริปต์นี้ ต้อง Deploy ใหม่ (Manage deployments > แก้ไข > Version: New)
 * ไม่งั้น URL เดิมจะยังรันโค้ดตัวเก่า
 */

/** โฟลเดอร์ที่เก็บคำขอ — ควรเป็นโฟลเดอร์ย่อย ไม่ใช่โฟลเดอร์ที่เก็บไฟล์โปรแกรม */
var INBOX_FOLDER_ID = '1Pzv82qI4dlwtn9Gd6Jn7ygRHgsIlUI7p';

/**
 * รหัสที่ต้องส่งมาด้วยถึงจะรับคำขอ
 *
 * กันคนที่บังเอิญเจอ URL แล้วยิงข้อมูลขยะเข้ามา ไม่ได้กันคนที่แกะโปรแกรมดู
 * เพราะรหัสนี้ติดไปกับโปรแกรมทุกเครื่อง — ความเสียหายสูงสุดคือมีไฟล์ขยะในโฟลเดอร์
 * ซึ่งลบทิ้งได้ ไม่กระทบข้อมูลผู้ป่วยหรือไฟล์โปรแกรม
 */
var SHARED_TOKEN = 'เปลี่ยนเป็นข้อความสุ่มของคุณเอง';

/** กันไฟล์ใหญ่ผิดปกติ คำขอหนึ่งใบเป็นข้อความล้วน ไม่ควรเกินนี้ */
var MAX_BYTES = 512 * 1024;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: 'ไม่มีข้อมูลส่งมา' });
    }
    if (e.postData.contents.length > MAX_BYTES) {
      return reply({ ok: false, error: 'ข้อมูลใหญ่เกินกำหนด' });
    }

    var body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) {
      return reply({ ok: false, error: 'รหัสไม่ถูกต้อง' });
    }

    var report = body.report;
    if (!report || !report.name || !report.sql) {
      return reply({ ok: false, error: 'ข้อมูลรายงานไม่ครบ (ต้องมีชื่อและคำสั่ง SQL)' });
    }

    var folder = DriveApp.getFolderById(INBOX_FOLDER_ID);

    // ชื่อไฟล์ขึ้นต้นด้วยวันเวลา เพื่อให้เรียงตามลำดับที่ส่งเข้ามาเอง
    // และตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้ออก ไม่งั้น Drive จะปฏิเสธ
    var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
    var safeName = String(report.name).replace(/[\\\/:*?"<>|]/g, '').slice(0, 60).trim();
    var kind = body.kind === 'revision' ? 'แก้ไข' : 'ใหม่';
    var fileName = stamp + '_' + kind + '_' + safeName + '.json';

    var payload = {
      format: 'ndp-kit-report-request',
      version: 1,
      kind: body.kind === 'revision' ? 'revision' : 'new',
      targetId: body.targetId || '',
      sender: body.sender || '',
      hospital: body.hospital || '',
      note: body.note || '',
      submittedAt: new Date().toISOString(),
      report: report
    };

    folder.createFile(fileName, JSON.stringify(payload, null, 2), 'application/json');
    return reply({ ok: true, fileName: fileName });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** เปิด URL ตรงๆ ด้วยเบราว์เซอร์จะเจอข้อความนี้ ใช้ตรวจว่า deploy สำเร็จแล้ว */
function doGet() {
  return reply({ ok: true, service: 'ndp-kit report inbox' });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
