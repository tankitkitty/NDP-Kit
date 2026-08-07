import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { DriveVersion, downloadUrl, listVersions } from "./driveRelease";

/**
 * โปรแกรมถูกติดตั้งโดยตัวช่วยติดตั้งไว้แบบนี้
 *   C:\NDP-Kit\app\      <- cwd ตอนรัน (server.js อยู่ที่นี่)
 *   C:\NDP-Kit\node\node.exe
 *   C:\NDP-Kit\start.vbs
 * การอัปเดตในตัวจึงทำได้เฉพาะเมื่อเจอโครงสร้างนี้ครบ ถ้ารันจากซอร์สโค้ดของนักพัฒนา
 * (npm run dev) จะไม่มีไฟล์พวกนี้ ต้องไม่ให้กดอัปเดตได้
 */
export function getInstallRoot(): string | null {
  const root = path.dirname(process.cwd());
  const startVbs = path.join(root, "start.vbs");
  const nodeExe = path.join(root, "node", "node.exe");
  if (fs.existsSync(startVbs) && fs.existsSync(nodeExe)) return root;
  return null;
}

export function isManagedInstall(): boolean {
  return getInstallRoot() !== null;
}

/**
 * ขั้นตอนที่การอัปเดตกำลังทำอยู่ อ่านจากไฟล์สถานะ
 *
 * ทุกสถานะเขียนโดยตัวโปรแกรมเองทั้งหมด ไม่พึ่งสคริปต์ภายนอกอีกต่อไป
 *
 * เดิมให้สคริปต์ PowerShell เป็นคนดาวน์โหลดและรายงานสถานะ แต่พบที่หน่วยบริการจริงว่า
 * ระบบของเครื่องสกัดการเปิด PowerShell แบบซ่อนหน้าต่างจาก process เบื้องหลังไว้
 * สคริปต์จึงไม่เคยถูกเรียกให้ทำงาน ไม่มีใครเขียน log ไม่มีใครเขียนสถานะ หน้าเว็บ
 * เลยค้างที่ "กำลังดาวน์โหลด" ตลอดไปโดยไม่มีอะไรบอกสาเหตุ
 *
 * ตอนนี้ตัวโปรแกรมดาวน์โหลดและแตกไฟล์เองด้วย Node ความผิดพลาดทุกแบบจึงกลายเป็น
 * ข้อความที่รายงานให้ผู้ใช้เห็นได้ทันที เหลือให้ตัวช่วยภายนอกทำแค่ขั้นสลับไฟล์
 * และเปิดโปรแกรมใหม่เท่านั้น
 */
export type UpdateStage =
  | "downloading"
  | "extracting"
  /** แตกไฟล์เสร็จ รอสลับไฟล์ตอนเปิดโปรแกรมครั้งถัดไป */
  | "staged"
  | "restarting"
  | "done"
  | "failed";

/** ข้อความอธิบายสาเหตุตอนล้มเหลว ให้ผู้ใช้เห็นว่าเกิดอะไรขึ้นจริงๆ */
export function readUpdateError(): string {
  const root = getInstallRoot();
  if (!root) return "";
  try {
    const p = path.join(root, "logs", "update-error.txt");
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf-8").trim();
  } catch {
    return "";
  }
}

function writeUpdateError(message: string): void {
  const root = getInstallRoot();
  if (!root) return;
  try {
    const dir = path.join(root, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "update-error.txt"), message, "utf8");
  } catch {
    // เขียนไม่ได้ก็ยังมีสถานะ failed บอกอยู่
  }
}

export function readUpdateStage(): UpdateStage | null {
  const root = getInstallRoot();
  if (!root) return null;
  try {
    const p = path.join(root, "logs", "update-status.txt");
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8").trim();
    return raw ? (raw as UpdateStage) : null;
  } catch {
    return null;
  }
}

export function writeUpdateStage(stage: UpdateStage): void {
  const root = getInstallRoot();
  if (!root) return;
  try {
    const dir = path.join(root, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "update-status.txt"), stage, "utf8");
  } catch {
    // เขียนไม่ได้ก็แค่ทำให้หน้าเว็บบอกความคืบหน้าละเอียดน้อยลง ไม่กระทบการอัปเดต
  }
}

export function clearUpdateStage(): void {
  const root = getInstallRoot();
  if (!root) return;
  try {
    // ต้องลบข้อความผิดพลาดของรอบก่อนด้วย ไม่งั้นถ้ารอบใหม่ล้มเหลวคนละสาเหตุ
    // หน้าเว็บจะเอาเหตุผลเก่ามาแสดง แล้วผู้ใช้จะแก้ผิดจุด
    for (const name of ["update-status.txt", "update-error.txt"]) {
      const p = path.join(root, "logs", name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {
    // ลบไม่ได้ก็ไม่เป็นไร ไฟล์จะถูกเขียนทับตอนอัปเดตรอบหน้าอยู่แล้ว
  }
}

// การเทียบเลขเวอร์ชันอยู่ที่ lib/version.ts ที่เดียว เพราะทั้งฝั่งเซิร์ฟเวอร์
// ฝั่งเบราว์เซอร์ และตัวอ่านรายการจาก Drive ต้องตัดสินว่า "ใหม่กว่า" ให้ตรงกันเป๊ะ
// ถ้าแยกกันเขียนแล้วหลุดที่ใดที่หนึ่ง เครื่องจะเทียบผิดโดยไม่มีอะไรฟ้อง
export { isNewer } from "./version";

/**
 * รายการเวอร์ชันที่อ่านมาครั้งล่าสุด เก็บไว้กันถามซ้ำถี่เกินจำเป็น
 *
 * แถบเมนูด้านซ้ายแสดงสถานะเวอร์ชันอยู่ทุกหน้า ถ้าไปถามใหม่ทุกครั้งที่ผู้ใช้เปลี่ยน
 * หน้า ก็เป็นการยิงคำขอออกเน็ตทิ้งเปล่าๆ ทั้งวันโดยไม่ได้อะไรเพิ่ม เวอร์ชันใหม่
 * ออกไม่กี่ครั้งต่อสัปดาห์ ไม่มีเหตุต้องรู้เร็วกว่านี้ และผู้ใช้กดปุ่มตรวจเองได้ทุกเมื่อ
 *
 * เดิมที่ต้องพักไว้นานเพราะ GitHub จำกัด 60 ครั้งต่อชั่วโมงต่อ IP ซึ่งทั้งหน่วยแชร์กัน
 * ตอนนี้ย้ายมาอ่านจาก Drive แล้วไม่มีเพดานแบบนั้น แต่ยังพักไว้เท่าเดิมเพราะเหตุผล
 * เรื่องความจำเป็นข้างต้นยังอยู่ และหน่วยบริการหลายแห่งเน็ตช้า
 */
let cachedVersions: DriveVersion[] = [];
let cachedAt = 0;
const TAG_CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * เวลาที่ถามแล้วล้มเหลวครั้งล่าสุด — ใช้หยุดการถามซ้ำระหว่างที่ยังมีปัญหา
 *
 * เดิมเมื่อถามไม่สำเร็จจะไม่พักอะไรไว้เลย ทุกครั้งที่มีคนเปิดหน้าเว็บจึงยิงถาม
 * ใหม่ทันที ซึ่งกลับหัวกลับหางกับสิ่งที่ควรทำ: ตอนปลายทางมีปัญหาอยู่แล้ว
 * ระบบจะยิ่งถามถี่ขึ้นอีก และไม่มีทางหลุดออกจากสภาพนั้นเองเลย
 */
let failedAt = 0;
let failedMessage = "";
const FAIL_BACKOFF_MS = 30 * 60 * 1000;

/**
 * รายการเวอร์ชันทั้งหมดที่มีให้ติดตั้ง เรียงจากใหม่ไปเก่า
 *
 * คืนทั้งรายการไม่ใช่แค่ตัวล่าสุด เพราะหน้าเว็บให้ผู้ดูแลเลือกเวอร์ชันที่จะติดตั้งเองได้
 * เช่นเวอร์ชันใหม่มีปัญหาแล้วอยากถอยกลับไปตัวก่อนหน้า
 */
export async function fetchVersions(force = false): Promise<DriveVersion[]> {
  if (!force) {
    if (cachedVersions.length && Date.now() - cachedAt < TAG_CACHE_MS) return cachedVersions;
    // ยังอยู่ในช่วงพักหลังถามไม่สำเร็จ — ตอบด้วยเหตุผลเดิมโดยไม่ไปยิงซ้ำ
    if (failedAt && Date.now() - failedAt < FAIL_BACKOFF_MS) {
      throw new Error(failedMessage || "ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ");
    }
  }

  try {
    const versions = await listVersions();
    if (versions.length === 0) {
      // อ่านโฟลเดอร์ได้แต่ไม่มีไฟล์ที่ชื่อบอกเลขเวอร์ชันเลย มักแปลว่าผู้ดูแลยังไม่ได้
      // อัปไฟล์ หรืออัปแล้วตั้งชื่อไม่มีเลขเวอร์ชัน บอกให้ตรงจะได้แก้ถูกจุด
      throw new Error("ยังไม่มีไฟล์เวอร์ชันในโฟลเดอร์ที่กำหนด กรุณาแจ้งผู้ดูแลระบบ");
    }
    cachedVersions = versions;
    cachedAt = Date.now();
    failedAt = 0;
    failedMessage = "";
    return versions;
  } catch (error: any) {
    failedAt = Date.now();
    failedMessage = String(error?.message || error);
    throw error;
  }
}

export async function fetchLatestVersion(force = false): Promise<string> {
  const versions = await fetchVersions(force);
  return versions[0].tag;
}

/** หาไฟล์ของเวอร์ชันที่ระบุ ใช้ตอนจะดาวน์โหลดจริง */
async function findVersion(tag: string): Promise<DriveVersion> {
  // ถามสดเสมอ เพราะกำลังจะโหลดไฟล์จริง ถ้าใช้รายการที่พักไว้แล้วผู้ดูแลเพิ่งลบ
  // หรือเปลี่ยนไฟล์ไป จะได้รหัสไฟล์ที่ใช้ไม่ได้แล้วไปตายกลางทางแทน
  const versions = await fetchVersions(true);
  const hit = versions.find((v) => v.tag === tag);
  if (!hit) throw new Error(`ไม่พบไฟล์ของเวอร์ชัน ${tag} ในโฟลเดอร์ที่กำหนด`);
  return hit;
}

/**
 * ดาวน์โหลดและแตกไฟล์เวอร์ชันใหม่ด้วย Node ทั้งหมด
 *
 * ทำงานเป็นเบื้องหลัง ไม่ให้ผู้ใช้ค้างรอ และรายงานความคืบหน้าผ่านไฟล์สถานะ
 * ที่หน้าเว็บถามเป็นระยะ ทุกความผิดพลาดถูกจับมาเขียนเป็นข้อความให้ผู้ใช้อ่านได้
 *
 * แตกไฟล์ลง app.new ไม่ใช่ทับ app ตรงๆ เพราะไฟล์ของโปรแกรมที่กำลังทำงานอยู่
 * ถูกล็อกโดย Windows ทับไม่ได้ การสลับจริงเกิดตอนเปิดโปรแกรมครั้งถัดไป ซึ่ง
 * start.cmd เป็นคนทำให้ (ดู install/ndp-kit-setup.ps1)
 */
export async function stageUpdate(tag: string): Promise<void> {
  const root = getInstallRoot();
  if (!root) throw new Error("เครื่องนี้ไม่ได้ติดตั้งผ่านตัวช่วยติดตั้ง");
  if (!tag) throw new Error("ไม่รู้ว่าจะอัปเดตเป็นเวอร์ชันอะไร");

  const zipPath = path.join(root, "update.zip");
  const stageDir = path.join(root, "app.new");

  try {
    writeUpdateStage("downloading");

    // หารหัสไฟล์บน Drive ของเวอร์ชันนี้ก่อน ที่อยู่ดาวน์โหลดผูกกับรหัสไฟล์ซึ่งไม่ซ้ำ
    // กันเลยทุกไฟล์ จึงไม่มีทางที่แคชระหว่างทางจะคืนไฟล์ของเวอร์ชันอื่นกลับมา
    const version = await findVersion(tag);

    const res = await fetch(downloadUrl(version), {
      headers: { "User-Agent": "ndp-kit-updater", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(600000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ ปลายทางตอบกลับรหัส ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100000) {
      // ไฟล์จริงมีขนาดหลายเมกะไบต์ ถ้าได้มานิดเดียวแปลว่าโดน proxy ส่งหน้า error
      // หรือหน้า login ของระบบกรองเว็บกลับมาแทนไฟล์จริง
      //
      // ฝั่ง Drive ยังมีอีกกรณีคือไฟล์ใหญ่เกินราว 25 MB ซึ่ง Drive จะส่งหน้ายืนยัน
      // ว่าสแกนไวรัสไม่ได้กลับมาเป็น HTML แทนไฟล์ ด่านนี้ดักไว้ให้แล้วเช่นกัน
      throw new Error("ไฟล์ที่ได้มาเล็กผิดปกติ อาจถูกระบบกรองเว็บของหน่วยงานขวางไว้");
    }
    fs.writeFileSync(zipPath, buf);

    writeUpdateStage("extracting");
    fs.rmSync(stageDir, { recursive: true, force: true });

    const zip = new AdmZip(zipPath);
    assertNoPathTraversal(zip, stageDir);
    zip.extractAllTo(stageDir, true);

    if (!fs.existsSync(path.join(stageDir, "server.js"))) {
      throw new Error("ไฟล์ที่ดาวน์โหลดมาไม่สมบูรณ์ (ไม่พบ server.js)");
    }

    // ตรวจว่าได้เวอร์ชันที่ขอมาจริง ไม่ใช่ของเก่าจากแคชระหว่างทาง
    //
    // ถ้าไม่ตรวจตรงนี้ การอัปเดตจะ "สำเร็จ" ทุกขั้นตอนแต่เวอร์ชันไม่ขยับ แล้วหน้าเว็บ
    // จะรอเวอร์ชันใหม่ที่ไม่มีวันมาถึงจนค้างไปเรื่อยๆ โดยไม่มีอะไรบอกสาเหตุ
    const versionFile = path.join(stageDir, "version.txt");
    const got = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf-8").trim() : "";
    if (got !== tag) {
      throw new Error(
        `ไฟล์ที่ได้มาเป็นเวอร์ชัน ${got || "ที่ระบุไม่ได้"} ไม่ใช่ ${tag} ` +
          `อาจถูกแคชของเครือข่ายคืนไฟล์เก่ากลับมา กรุณาลองใหม่อีกครั้ง`
      );
    }

    fs.rmSync(zipPath, { force: true });
    writeUpdateStage("staged");
  } catch (error: any) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    writeUpdateError(String(error?.message || error));
    writeUpdateStage("failed");
    throw error;
  }
}

/**
 * ปฏิเสธไฟล์อัปเดตที่มี entry ชี้ออกนอกโฟลเดอร์ปลายทาง (Zip Slip)
 *
 * ตัวแตกไฟล์เชื่อชื่อ entry ตามที่เขียนมาในไฟล์ zip ถ้ามี entry ชื่อ "..\..\start.cmd"
 * หรือ path แบบเต็ม (C:\...) มันจะเขียนทับไฟล์นอก app.new ให้เลย ซึ่งกลายเป็นการ
 * รันโค้ดบนเครื่องหน่วยบริการได้ทันทีในรอบเปิดโปรแกรมถัดไป
 *
 * ต่อให้ไฟล์มาจาก Google Drive ผ่าน https ก็ยังต้องตรวจ เพราะถ้าบัญชีผู้ดูแลถูกยึด
 * หรือมีใครอัปไฟล์ปลอมเข้าโฟลเดอร์ได้ ทุกหน่วยบริการจะดึงไปรันพร้อมกันทั้งหมด
 */
function assertNoPathTraversal(zip: AdmZip, targetDir: string): void {
  const root = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (name.includes("\0")) {
      throw new Error("ไฟล์อัปเดตมีชื่อไฟล์ผิดปกติ ไม่ปลอดภัยที่จะแตกไฟล์");
    }
    const resolved = path.resolve(root, name);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`ไฟล์อัปเดตพยายามเขียนไฟล์นอกโฟลเดอร์ที่กำหนด (${name}) — ยกเลิกการอัปเดตเพื่อความปลอดภัย`);
    }
  }
}

/** มีเวอร์ชันใหม่รออยู่ พร้อมสลับตอนเปิดโปรแกรมครั้งถัดไปหรือยัง */
export function hasStagedUpdate(): boolean {
  const root = getInstallRoot();
  if (!root) return false;
  try {
    return fs.existsSync(path.join(root, "app.new", "server.js"));
  } catch {
    return false;
  }
}
