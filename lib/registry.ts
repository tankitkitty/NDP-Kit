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

// บันทึกคำตอบของแบบฟอร์มยินยอม และเวอร์ชันที่รายงานไปแล้ว
// เก็บใน data/ เหมือนค่าตั้งค่าอื่น จึงติดไปกับเครื่องนั้นและไม่หายตอนอัปเดต
const consentPath = path.join(process.cwd(), "data", ".registered");

export function isRegistryEnabled(): boolean {
  return REGISTRY_URL.length > 0;
}

export type ConsentRecord = {
  /** ผู้ใช้กดยินยอมหรือไม่ — ถ้าไม่ยินยอมจะไม่ส่งอะไรออกไปอีกเลย */
  consent: boolean;
  /** เวอร์ชันที่รายงานไปแล้วล่าสุด (มีค่าเมื่อยินยอมและส่งสำเร็จ) */
  version?: string;
  at: string;
};

export function readConsent(): ConsentRecord | null {
  try {
    if (!fs.existsSync(consentPath)) return null;
    return JSON.parse(fs.readFileSync(consentPath, "utf-8")) as ConsentRecord;
  } catch {
    return null;
  }
}

export function saveConsent(consent: boolean, version?: string): void {
  try {
    fs.mkdirSync(path.dirname(consentPath), { recursive: true });
    fs.writeFileSync(
      consentPath,
      JSON.stringify({ consent, version, at: new Date().toISOString() }, null, 2),
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

/**
 * ต้องตรงกับรายการที่แสดงในแบบฟอร์มยินยอม (components/ConsentDialog.tsx) เสมอ
 * ถ้าจะเพิ่มหรือลดฟิลด์ ต้องแก้ข้อความในฟอร์มให้ตรงกันด้วย ไม่งั้นฟอร์มจะระบุ
 * ไม่ตรงกับสิ่งที่โปรแกรมส่งจริง
 */
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
  // ให้เวลานานหน่อย เพราะ Google Apps Script เปลี่ยนเส้นทางไปอีกโดเมนหนึ่ง
  // และถ้าสคริปต์ไม่ถูกเรียกมาสักพักจะมี cold start อีกหลายวินาที รวมกับเน็ต
  // ของโรงพยาบาลที่มักช้า เวลา 15 วินาทีเดิมจึงหมดก่อนบ่อยจนส่งไม่สำเร็จ
  const res = await fetch(REGISTRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`ปลายทางตอบกลับรหัส ${res.status}`);
}
