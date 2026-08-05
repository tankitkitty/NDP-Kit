// โครงสร้างผลลัพธ์ของการ์ดตรวจสอบแต่ละใบ (1 หัวข้อ = 1 CheckOutcome)

/** คอลัมน์ที่จะแสดงในตารางรายละเอียด พร้อมป้ายชื่อภาษาไทย */
export interface CheckColumn {
  key: string;
  label: string;
}

/**
 * คีย์พิเศษในแถวข้อมูล ใส่ค่า true เพื่อให้ตารางเน้นแถวนั้นเป็นสีแดง
 *
 * ใช้กับตารางที่แสดงข้อมูลทั้งหมดปนกัน ทั้งที่ถูกและที่ผิด ซึ่งจำเป็นเวลาผู้ใช้ต้อง
 * เห็นภาพรวมการตั้งค่าทั้งชุด ไม่ใช่เห็นแต่แถวที่ผิด — ถ้าไม่เน้นสีจะหาไม่เจอว่า
 * แถวไหนคือแถวที่ต้องแก้
 *
 * ไม่ต้องประกาศเป็น column เพราะตัวแสดงผลวาดเฉพาะ column ที่ระบุไว้เท่านั้น
 * คีย์นี้จึงไม่โผล่มาเป็นช่องในตาราง
 */
export const ROW_ALERT_KEY = "_alert";

/**
 * คีย์พิเศษแบบเดียวกับ ROW_ALERT_KEY แต่เน้นแถวเป็นสีเหลือง = "น่าสงสัย ควรตรวจทาน"
 *
 * ใช้กับกรณีที่ระบบฟันธงไม่ได้ว่าผิด เช่น ค่าถูกต้องตามรูปแบบแล้วแต่ดูแล้วไม่สมเหตุผล
 * ถ้าเน้นเป็นสีแดงปนกับแถวที่ผิดจริง ผู้ใช้จะแยกไม่ออกว่าอันไหนต้องแก้แน่ๆ
 * อันไหนแค่ต้องไปดูอีกที
 *
 * แถวหนึ่งควรมีได้อย่างใดอย่างหนึ่ง ถ้าใส่มาทั้งคู่ตัวแสดงผลจะถือว่าเป็นสีแดง
 */
export const ROW_WARN_KEY = "_warn";

/**
 * สัญลักษณ์แทนคำว่า "ถูกต้อง" ในช่องผลตรวจของตาราง
 *
 * ใช้เครื่องหมายถูกสีเขียวแทนตัวหนังสือ เพราะแถวที่ถูกต้องมักเป็นส่วนใหญ่ของตาราง
 * ถ้าเขียนเป็นคำ ตาจะต้องอ่านทุกแถวเพื่อหาแถวที่ผิด แต่ถ้าเป็นสัญลักษณ์จะกวาดตา
 * เจอแถวที่ไม่มีเครื่องหมายได้ทันที
 *
 * ใช้ตัวเดียวกับป้ายสถานะหัวการ์ด (✅ ผ่าน) เพื่อให้ทั้งหน้าสื่อความหมายตรงกัน
 */
export const OK_MARK = "✅";

/** ตารางย่อยหนึ่งชุดในการ์ด (บางหัวข้อมีหลายตาราง เช่น token มีทั้ง sys_var และ nhso_token) */
export interface CheckSection {
  title?: string;
  columns: CheckColumn[];
  rows: Record<string, unknown>[];
  /** หมายเหตุใต้ตาราง เช่น "แสดง 500 รายการแรก" */
  note?: string;
}

export type CheckStatus =
  | "pass" // ✅ ไม่พบปัญหา
  | "issues" // ⚠️ พบรายการที่ต้องแก้
  | "empty" // ไม่มีข้อมูลให้ตรวจในเงื่อนไขที่เลือก — ยังตัดสินไม่ได้ว่าผ่านหรือไม่ผ่าน
  | "info" // ℹ️ ข้อมูลประกอบ ไม่นับเป็นผ่าน/ไม่ผ่าน (เช่น log การส่ง)
  | "unavailable"; // ตรวจไม่ได้ (ตาราง/คอลัมน์ไม่พบในฐานนี้ หรือ query ผิดพลาด)

export interface CheckOutcome {
  id: string;
  status: CheckStatus;
  /** จำนวนรายการที่พบปัญหา (0 เมื่อผ่าน) */
  problemCount: number;
  /** สรุปหนึ่งบรรทัดใต้หัวการ์ด */
  summary: string;
  sections: CheckSection[];
  /** คำอธิบายว่าทำไมถึงเป็นปัญหา + วิธีแก้ (ข้อความ) */
  advice: string;
  /** SQL แก้ไขให้ copy ไปรันเอง (ไม่ execute อัตโนมัติ) */
  fixSql?: string;
  /** true = หัวข้อนี้มีคำสั่งแก้ไขฝั่ง server ที่กดยืนยันแล้วรันได้ (ผ่าน /api/precheck/fix) */
  canExecuteFix?: boolean;
  /** ข้อความ error กรณี status = unavailable */
  error?: string;
}

/** พารามิเตอร์ร่วมที่ส่งให้ทุก check (บางตัวใช้ช่วงวันที่) */
export interface CheckContext {
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
}

export interface CheckDefinition {
  id: string;
  title: string;
  description: string;
  /** true = ต้องใช้ช่วงวันที่ (จาก date picker บนหน้า dashboard) */
  needsRange?: boolean;
  run: (ctx: CheckContext) => Promise<CheckOutcome>;
}

/** สร้าง outcome กรณี query ล้มเหลว (ตาราง/คอลัมน์ไม่ตรงรุ่น HOSxP) แบบเดียวกันทุกการ์ด */
export function unavailableOutcome(id: string, advice: string, error: unknown): CheckOutcome {
  return {
    id,
    status: "unavailable",
    problemCount: 0,
    summary: "ตรวจไม่ได้ — โครงสร้างตารางในฐานนี้ไม่ตรงกับที่คาดไว้",
    sections: [],
    advice,
    error: error instanceof Error ? error.message : String(error),
  };
}
