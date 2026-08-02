import { query } from "../db";

/**
 * ตัวกลางสำหรับ query "อ่านอย่างเดียว" ของหน้าตรวจความพร้อมทั้งหมด
 * ทุก check ต้องเรียกผ่านฟังก์ชันนี้เท่านั้น — กันพลาดเขียนลงฐาน HOSxP
 * (ตาราง HOSxP เป็น MyISAM ไม่มี transaction, rollback ไม่ได้)
 *
 * แนะนำเพิ่มเติม: สร้าง MySQL user ที่มีสิทธิ์ SELECT อย่างเดียวไว้ใช้กับแอปนี้
 * (ดู .env.example) — โค้ดชั้นนี้เป็นด่านที่สอง ไม่ใช่ด่านเดียว
 */
export async function selectOnly(sql: string, values?: unknown[]): Promise<any> {
  // ตัด comment นำหน้าออกก่อนตรวจ เพื่อไม่ให้ /* ... */ SELECT หลุดการเช็ค
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();

  if (!/^select\b/i.test(stripped)) {
    throw new Error("อนุญาตเฉพาะคำสั่ง SELECT เท่านั้น (read-only)");
  }
  // กัน multi-statement และคำสั่งที่เขียนไฟล์/ล็อกแถวแฝงมากับ SELECT
  if (stripped.includes(";")) {
    throw new Error("ไม่อนุญาตหลายคำสั่งใน query เดียว");
  }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(stripped) || /\bfor\s+update\b/i.test(stripped)) {
    throw new Error("ไม่อนุญาตคำสั่งที่เขียนไฟล์หรือล็อกแถว");
  }

  return query(sql, values as any[]);
}
