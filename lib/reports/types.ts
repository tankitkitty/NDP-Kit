/** ชนิดค่าที่รับจากผู้ใช้ก่อนรันรายงาน — จำกัดไว้เท่าที่แปลงเป็นค่าปลอดภัยได้ */
export type ReportParamType = "date" | "text" | "number";

export interface ReportParam {
  /** ชื่อที่อ้างใน SQL ด้วย :ชื่อ เช่น :from — ต้องเป็น a-z 0-9 _ เท่านั้น */
  name: string;
  /** ป้ายที่แสดงบนหน้าจอ เช่น "ตั้งแต่วันที่" */
  label: string;
  type: ReportParamType;
  /** ค่าตั้งต้นที่เติมให้ในช่องกรอก */
  defaultValue?: string;
}

/**
 * รายงานหนึ่งใบที่ผู้ใช้เขียนเอง
 *
 * เก็บเป็น JSON ใน data/reports.json ไม่ได้เก็บลงฐาน HOSxP เพราะแอปนี้ต้องไม่เขียน
 * อะไรลงฐานของโรงพยาบาลเลย และการเก็บเป็นไฟล์ทำให้ส่งต่อให้หน่วยอื่นได้ง่าย
 */
export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * หมวดของรายงาน เช่น "งานส่งเสริมป้องกัน" — เว้นว่างได้
   *
   * เป็นข้อความอิสระ ไม่ใช่รายการตายตัว เพราะแต่ละหน่วยบริการแบ่งงานกันคนละแบบ
   * และรายงานที่รับมาจากหน่วยอื่นก็พกหมวดของตัวเองมาด้วย ถ้าบังคับให้เลือกจาก
   * รายการที่เรากำหนด หมวดที่ติดมากับไฟล์จะตกหล่นทันที
   */
  group: string;
  /** คำสั่ง SELECT ที่ผู้ใช้เขียน อ้างพารามิเตอร์ด้วย :ชื่อ */
  sql: string;
  params: ReportParam[];
  /** ชื่อผู้เขียน/หน่วยงานต้นทาง ติดไปกับไฟล์เวลาส่งต่อ */
  author: string;
  /**
   * local = เขียนเองในเครื่องนี้ · imported = รับไฟล์มาจากหน่วยงานอื่น
   *
   * แยกไว้เพื่อเตือนผู้ใช้ว่าคำสั่งนี้คนอื่นเขียน ต้องอ่านก่อนรัน — ถึงระบบจะกรอง
   * คำสั่งอันตรายให้แล้ว แต่ SQL ที่ "ปลอดภัย" ก็ยังดึงข้อมูลผู้ป่วยออกมาได้ทั้งฐาน
   */
  source: "local" | "imported";
  createdAt: string;
  updatedAt: string;
}

/** รูปแบบไฟล์ที่ใช้ส่งต่อรายงานระหว่างหน่วยบริการ */
export interface ReportBundle {
  format: "ndp-kit-report";
  version: 1;
  exportedAt: string;
  exportedBy: string;
  reports: ReportDefinition[];
}

export const BUNDLE_FORMAT = "ndp-kit-report";
export const BUNDLE_VERSION = 1;
