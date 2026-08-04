import fs from "fs";
import path from "path";

/**
 * ปลายทางที่รับข้อมูลการลงทะเบียนหน่วยบริการ (Google Apps Script Web App)
 *
 * ปล่อยว่างไว้ = ปิดฟีเจอร์นี้ทั้งหมด ไม่ถามผู้ใช้ และไม่ส่งอะไรออกไปเลย
 * ใส่ URL ที่ลงท้ายด้วย /exec ตรงนี้เพื่อเปิดใช้งาน (ดูวิธีสร้างใน docs/google-sheet.md)
 *
 * ตั้งผ่าน env REGISTRY_URL ทับได้ เผื่ออยากเปลี่ยนปลายทางโดยไม่ต้อง build ใหม่
 */
const DEFAULT_REGISTRY_URL =
  "https://script.google.com/macros/s/AKfycbxOeSV5w3ezb1jR2l34EkS9cqcvyHCqzJiV7kZ_UNa_lk6szNY3xtWkpn3ZHTJZC35Z/exec";

export const REGISTRY_URL = (process.env.REGISTRY_URL || DEFAULT_REGISTRY_URL).trim();

// บันทึกว่าเคยถามไปแล้ว เพื่อไม่ให้ถามซ้ำทุกครั้งที่เปิดหน้าตั้งค่า
// เก็บใน data/ เหมือนค่าตั้งค่าอื่น จึงติดไปกับเครื่องนั้นและไม่หายตอนอัปเดต
const answeredPath = path.join(process.cwd(), "data", ".registered");

export function isRegistryEnabled(): boolean {
  return REGISTRY_URL.length > 0;
}

export type AnsweredRecord = {
  /** ผู้ใช้กดยินยอมให้ส่งหรือไม่ — ถ้าปฏิเสธจะไม่ส่งอะไรอีกเลย */
  sent: boolean;
  at: string;
  /** เวอร์ชันที่รายงานไปแล้วล่าสุด ใช้ดูว่าต้องส่งอัปเดตซ้ำไหม */
  version?: string;
};

export function readAnswered(): AnsweredRecord | null {
  try {
    if (!fs.existsSync(answeredPath)) return null;
    return JSON.parse(fs.readFileSync(answeredPath, "utf-8")) as AnsweredRecord;
  } catch {
    return null;
  }
}

export function hasAnswered(): boolean {
  return readAnswered() !== null;
}

export function markAnswered(sent: boolean, version: string): void {
  try {
    fs.mkdirSync(path.dirname(answeredPath), { recursive: true });
    fs.writeFileSync(
      answeredPath,
      JSON.stringify({ sent, at: new Date().toISOString(), version }, null, 2),
      { encoding: "utf-8", mode: 0o600 }
    );
  } catch {
    // เขียนไม่ได้ก็แค่ถามใหม่รอบหน้า ไม่ใช่เรื่องคอขาดบาดตาย
  }
}

/** เลขเวอร์ชันมาจาก version.txt ที่ workflow ใส่ไว้ในแพ็กเกจตอนออก release */
export function getAppVersion(): string {
  try {
    const p = path.join(process.cwd(), "version.txt");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").trim();
  } catch {}
  return "";
}

export type RegistryPayload = {
  hospitalCode: string;
  hospitalName: string;
  version: string;
  sentAt: string;
};

/**
 * ส่งจากฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ได้ยิงจากเบราว์เซอร์ผู้ใช้
 * ทำให้ไม่ติดเรื่อง CORS และ URL ปลายทางไม่โผล่ในหน้าเว็บให้ใครก็ได้เอาไปยิงเล่น
 */
export async function sendToRegistry(payload: RegistryPayload): Promise<void> {
  const res = await fetch(REGISTRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ปลายทางตอบกลับรหัส ${res.status}`);
}
