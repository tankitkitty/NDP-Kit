import fs from "fs";
import os from "os";
import path from "path";
import { getInstallRoot } from "./updater";

/**
 * ปลายทางที่รับข้อมูลการลงทะเบียนหน่วยบริการ (Google Apps Script Web App)
 *
 * ปล่อยว่างไว้ = ปิดฟีเจอร์นี้ทั้งหมด ไม่ถามผู้ใช้ และไม่ส่งอะไรออกไปเลย
 * ใส่ URL ที่ลงท้ายด้วย /exec ตรงนี้เพื่อเปิดใช้งาน (ดูวิธีสร้างใน docs/google-sheet.md)
 *
 * ตั้งผ่าน env REGISTRY_URL ทับได้ เผื่ออยากเปลี่ยนปลายทางโดยไม่ต้อง build ใหม่
 */
const DEFAULT_REGISTRY_URL =
  "https://script.google.com/macros/s/AKfycbzK_FiHTAlt5dUmjVM2P4_MMK4_et2n7Ni7v05q6bB5de1ynEznUdvGsC-8OR0oQXuR/exec";

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
  /** เวลาที่ส่งรายงานสำเร็จครั้งล่าสุด (เก็บไว้ดูย้อนหลังเท่านั้น ไม่ได้ใช้ตัดสินใจส่ง) */
  lastSentAt?: string;
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

export function saveConsent(consent: boolean, version?: string, lastSentAt?: string): void {
  try {
    fs.mkdirSync(path.dirname(consentPath), { recursive: true });
    fs.writeFileSync(
      consentPath,
      JSON.stringify({ consent, version, lastSentAt, at: new Date().toISOString() }, null, 2),
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
  /** ชื่อเครื่องที่ติดตั้ง ใช้แยกว่าหน่วยเดียวกันลงไว้กี่เครื่อง */
  machineName: string;
  /** วันที่ติดตั้งครั้งแรกบนเครื่องนั้น (ว่างได้ถ้าไม่ได้ติดตั้งผ่านตัวช่วยติดตั้ง) */
  installedAt: string;
  /** วันที่อัปเดตเป็นเวอร์ชันที่ใช้อยู่ */
  updatedAt: string;
  version: string;
  sentAt: string;
};

/**
 * วันที่ติดตั้งครั้งแรก และวันที่อัปเดตล่าสุด
 *
 * ต้องอ่านจากคนละที่ เพราะการอัปเดต "แทนที่โฟลเดอร์ app ทั้งอัน" (ดู start.cmd ที่
 * ตัวช่วยติดตั้งสร้าง) ถ้าเอาวันที่ของโฟลเดอร์ app มาเป็นวันติดตั้ง ทุกครั้งที่อัปเดต
 * วันติดตั้งจะขยับตามไปด้วย จนดูไม่ออกว่าเครื่องนี้เริ่มใช้มาตั้งแต่เมื่อไหร่
 *
 *   installedAt = วันที่สร้างโฟลเดอร์รากของโปรแกรม ซึ่งสร้างครั้งเดียวตอนติดตั้งแรก
 *                 แล้วอยู่ยาวไม่เคยถูกแทนที่
 *   updatedAt   = วันที่แก้ไขล่าสุดของโฟลเดอร์ app ซึ่งเปลี่ยนทุกครั้งที่สลับไฟล์
 *
 * เครื่องที่รันจากซอร์ส (นักพัฒนา) จะไม่มีโฟลเดอร์ราก คืนค่าว่างไป
 */
export function getInstallDates(): { installedAt: string; updatedAt: string } {
  const iso = (d: Date | undefined) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : "");

  let installedAt = "";
  let updatedAt = "";
  try {
    const root = getInstallRoot();
    if (root) installedAt = iso(fs.statSync(root).birthtime);
  } catch {
    // อ่านไม่ได้ก็ส่งค่าว่าง ไม่ใช่เรื่องที่ต้องทำให้การรายงานล้มทั้งหมด
  }
  try {
    updatedAt = iso(fs.statSync(process.cwd()).mtime);
  } catch {
    /* เช่นเดียวกัน */
  }
  return { installedAt, updatedAt };
}

/**
 * ชื่อเครื่องที่ติดตั้งโปรแกรม
 *
 * ใช้แยกว่าหน่วยบริการเดียวกันลงไว้กี่เครื่อง เพราะแต่ละเครื่องรายงานด้วยรหัส
 * สถานบริการเดียวกัน ถ้าไม่มีชื่อเครื่องมาด้วยจะนับเป็นหน่วยเดียวกันหมดจนแยกไม่ออก
 *
 * เป็นชื่อเครื่องในเครือข่ายของหน่วยงาน (เช่น NURSE-PC01) ไม่ใช่ข้อมูลส่วนบุคคล
 * และไม่มีชื่อผู้ใช้ที่ล็อกอินติดไปด้วย
 */
export function getMachineName(): string {
  try {
    return os.hostname().trim().slice(0, 80);
  } catch {
    return "";
  }
}

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
