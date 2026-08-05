import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const REPO = "tankitkitty/NDP-Kit";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const ASSET_URL = `https://github.com/${REPO}/releases/latest/download/ndp-kit.zip`;

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

/** "v2.0.1" -> [2, 0, 1] ส่วนที่อ่านเป็นตัวเลขไม่ได้ให้เป็น 0 */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((n) => {
      const parsed = parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

/** true เมื่อ candidate ใหม่กว่า current จริงๆ เท่านั้น */
export function isNewer(candidate: string, current: string): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(LATEST_API, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub ปฏิเสธคำขอที่ไม่มี User-Agent
      "User-Agent": "ndp-kit-updater",
    },
    signal: AbortSignal.timeout(15000),
  });
  // 404 ที่ปลายทางนี้แปลว่ายังไม่มี release เผยแพร่เลย (มีแต่ git tag ซึ่งคนละอย่างกัน)
  // ไม่ใช่ความผิดของเครื่องหน่วยบริการ จึงบอกให้ตรงว่าเกิดอะไรขึ้น
  if (res.status === 404) {
    throw new Error("ยังไม่มีเวอร์ชันเผยแพร่บน GitHub กรุณาแจ้งผู้ดูแลระบบ");
  }
  if (res.status === 403) {
    throw new Error("GitHub จำกัดจำนวนครั้งการเรียกชั่วคราว กรุณาลองใหม่ในอีกสักครู่");
  }
  if (!res.ok) throw new Error(`GitHub ตอบกลับรหัส ${res.status}`);
  const data: any = await res.json();
  const tag = String(data?.tag_name || "").trim();
  if (!tag) throw new Error("ไม่พบเลขเวอร์ชันในข้อมูลที่ GitHub ส่งกลับมา");
  return tag;
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
export async function stageUpdate(): Promise<void> {
  const root = getInstallRoot();
  if (!root) throw new Error("เครื่องนี้ไม่ได้ติดตั้งผ่านตัวช่วยติดตั้ง");

  const zipPath = path.join(root, "update.zip");
  const stageDir = path.join(root, "app.new");

  try {
    writeUpdateStage("downloading");

    const res = await fetch(ASSET_URL, {
      headers: { "User-Agent": "ndp-kit-updater", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(600000),
    });
    if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ ปลายทางตอบกลับรหัส ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100000) {
      // ไฟล์จริงมีขนาดหลายเมกะไบต์ ถ้าได้มานิดเดียวแปลว่าโดน proxy ส่งหน้า error
      // หรือหน้า login ของระบบกรองเว็บกลับมาแทนไฟล์จริง
      throw new Error("ไฟล์ที่ได้มาเล็กผิดปกติ อาจถูกระบบกรองเว็บของหน่วยงานขวางไว้");
    }
    fs.writeFileSync(zipPath, buf);

    writeUpdateStage("extracting");
    fs.rmSync(stageDir, { recursive: true, force: true });

    new AdmZip(zipPath).extractAllTo(stageDir, true);

    if (!fs.existsSync(path.join(stageDir, "server.js"))) {
      throw new Error("ไฟล์ที่ดาวน์โหลดมาไม่สมบูรณ์ (ไม่พบ server.js)");
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
