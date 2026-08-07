/**
 * บีบอัดโฟลเดอร์แพ็กเกจให้เป็นไฟล์ zip ที่ฝั่งหน่วยบริการแตกได้
 *
 * ใช้ adm-zip ตัวเดียวกับที่ lib/updater.ts ใช้แตกไฟล์ จะได้มั่นใจว่าอ่านกันได้แน่
 *
 * ห้ามใช้ [System.IO.Compression.ZipFile]::CreateFromDirectory ของ PowerShell แทน
 * เด็ดขาด เพราะ .NET Framework 4.x ที่ Windows PowerShell 5.1 ใช้ เขียนชื่อ entry
 * ด้วย "\" ตามตัวคั่นของ Windows ซึ่งผิดสเปก ZIP (ข้อ 4.4.17.1 บังคับ "/")
 * ผลคือตัวแตกไฟล์ฝั่งหน่วยบริการจะได้ไฟล์ชื่อ ".next\BUILD_ID" แบนๆ อยู่ในโฟลเดอร์
 * เดียวกันหมด แทนที่จะเป็นโครงสร้างโฟลเดอร์จริง แล้วโปรแกรมจะเปิดไม่ขึ้นทั้งหน่วย
 * เจอมาแล้วตอนเขียน scripts/release.ps1 เมื่อ 7 ส.ค. 2569 — 1,862 entry เป็น "\" ทั้งหมด
 *
 * เรียกใช้:  node scripts/pack.js <โฟลเดอร์ต้นทาง> <ไฟล์ zip ปลายทาง> <เลขเวอร์ชัน>
 */
const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

const [srcDir, outFile, expectedVersion] = process.argv.slice(2);

if (!srcDir || !outFile) {
  console.error("ต้องระบุโฟลเดอร์ต้นทางและไฟล์ปลายทาง");
  process.exit(1);
}
if (!fs.existsSync(srcDir)) {
  console.error(`ไม่พบโฟลเดอร์ต้นทาง ${srcDir}`);
  process.exit(1);
}

if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });

const zip = new AdmZip();
zip.addLocalFolder(srcDir);
zip.writeZip(outFile);

// ตรวจไฟล์ที่เพิ่งเขียน ไม่ใช่เชื่อว่าถูกเพราะไม่มี error
const check = new AdmZip(outFile);
const entries = check.getEntries();
const names = entries.map((e) => e.entryName);

const problems = [];

const backslash = names.filter((n) => n.includes("\\"));
if (backslash.length) {
  problems.push(`มี ${backslash.length} รายการที่ใช้ "\\" เป็นตัวคั่น เช่น ${backslash[0]}`);
}

// entry ที่ชี้ออกนอกโฟลเดอร์ปลายทาง จะทำให้ตัวแตกไฟล์เขียนทับไฟล์ระบบได้
const traversal = names.filter((n) => n.startsWith("/") || n.split("/").includes(".."));
if (traversal.length) {
  problems.push(`มีรายการที่ชี้ออกนอกโฟลเดอร์ เช่น ${traversal[0]}`);
}

for (const must of ["server.js", "version.txt", ".next/BUILD_ID"]) {
  if (!names.includes(must)) problems.push(`ไม่พบ ${must}`);
}

// เลขในไฟล์ต้องตรงกับที่สั่ง เพราะตัวอัปเดตฝั่งหน่วยบริการเทียบสองค่านี้กัน
// ถ้าไม่ตรงมันจะปฏิเสธไฟล์แล้วทั้งหน่วยอัปเดตไม่ได้
if (expectedVersion) {
  const inZip = String(check.readAsText("version.txt") || "").trim();
  if (inZip !== expectedVersion) {
    problems.push(`version.txt ในไฟล์เป็น "${inZip}" ไม่ตรงกับ "${expectedVersion}"`);
  }
}

// ไฟล์ลับต้องไม่ติดไปกับแพ็กเกจที่จะเผยแพร่สู่สาธารณะ
const secrets = names.filter((n) =>
  /(^|\/)(dbconfig\.json|dbconfig43\.json|\.session-secret|\.env)$/.test(n)
);
if (secrets.length) problems.push(`พบไฟล์ลับในแพ็กเกจ: ${secrets.join(", ")}`);

if (problems.length) {
  console.error("บีบอัดแล้วแต่ตรวจไม่ผ่าน:");
  for (const p of problems) console.error(`  - ${p}`);
  fs.rmSync(outFile, { force: true });
  process.exit(1);
}

const sizeMb = (fs.statSync(outFile).size / 1048576).toFixed(2);
console.log(`entries=${entries.length}`);
console.log(`sizeMb=${sizeMb}`);
console.log(`version=${String(check.readAsText("version.txt")).trim()}`);
console.log(`file=${path.resolve(outFile)}`);
