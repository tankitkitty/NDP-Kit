import fs from "fs";
import path from "path";
import { getSession } from "./session";

const mainConfigPath = path.join(process.cwd(), "data", "dbconfig.json");

/**
 * ช่วงติดตั้งครั้งแรก: ยังไม่มีไฟล์ตั้งค่าฐานข้อมูลหลัก แปลว่ายังเชื่อมต่อ DB
 * ไม่ได้ จึงยัง login ไม่ได้ ต้องเปิดหน้า/หน้า API ตั้งค่าให้เข้าถึงได้ก่อน
 * เมื่อตั้งค่าเสร็จ (ไฟล์ถูกสร้าง) การเข้าถึง config/test-connection ทั้งหมด
 * จะต้องมี session เสมอ
 */
export function isBootstrapPhase(): boolean {
  return !fs.existsSync(mainConfigPath);
}

/**
 * อนุญาตให้ผ่านเมื่อ (ก) อยู่ในช่วงติดตั้งครั้งแรก หรือ (ข) มี session ที่ถูกต้อง
 */
export function isConfigAccessAllowed(req: { cookies: Partial<Record<string, string>> }): boolean {
  if (isBootstrapPhase()) return true;
  return getSession(req) !== null;
}
