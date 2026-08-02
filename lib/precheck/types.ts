// โครงสร้างผลลัพธ์ของการ์ดตรวจสอบแต่ละใบ (1 หัวข้อ = 1 CheckOutcome)

/** คอลัมน์ที่จะแสดงในตารางรายละเอียด พร้อมป้ายชื่อภาษาไทย */
export interface CheckColumn {
  key: string;
  label: string;
}

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
