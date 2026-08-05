import { CheckDefinition } from "./types";
import deformedNo, { DEFORMED_FIX_SQL, DEFORMED_COUNT_SQL } from "./checks/deformedNo";
import poCode from "./checks/poCode";
import provider from "./checks/provider";
import pttypeConfig from "./checks/pttypeConfig";
import token from "./checks/token";
import drugCatalog from "./checks/drugCatalog";
import servicePrice from "./checks/servicePrice";
import authCode from "./checks/authCode";
import claimLog from "./checks/claimLog";
import spcltyNhsoCode from "./checks/spcltyNhsoCode";
import postnatalCare from "./checks/postnatalCare";
import triferdine from "./checks/triferdine";
import pregnancyTest from "./checks/pregnancyTest";
import contraceptive from "./checks/contraceptive";

/** ทะเบียนการ์ดตรวจสอบทั้งหมด (ลำดับ = ลำดับที่แสดงบน dashboard) */
export const CHECKS: CheckDefinition[] = [
  deformedNo,
  poCode,
  provider,
  pttypeConfig,
  token,
  drugCatalog,
  servicePrice,
  authCode,
  claimLog,
  // ต่อท้ายเสมอ ไม่แทรกกลาง เพราะเลขข้อบนหน้าเว็บถูกอ้างถึงจากที่อื่น
  // (setup-checklist ชี้ไปที่ "การ์ดข้อ 8") แทรกกลางแล้วเลขจะเลื่อนทั้งแถบ
  spcltyNhsoCode,
  postnatalCare,
  triferdine,
  pregnancyTest,
  contraceptive,
];

export function getCheck(id: string): CheckDefinition | undefined {
  return CHECKS.find((c) => c.id === id);
}

/**
 * คำสั่งแก้ไขที่อนุญาตให้รันจากปุ่มยืนยันบนหน้าเว็บ — กำหนดไว้ฝั่ง server เท่านั้น
 * (API ไม่รับ SQL จาก client เด็ดขาด รับแค่ checkId) หัวข้ออื่นเป็นแบบ copy ไปรันเอง
 * เพราะต้องใช้วิจารณญาณเลือกค่าเป็นรายกรณี
 */
export const SERVER_FIXES: Record<string, { title: string; warning: string; sql: string; countSql: string }> = {
  "deformed-no": {
    title: "ปรับ deformed_no ให้ตรงกับ cid (เฉพาะแถวที่ cid ไม่ว่าง)",
    warning:
      "ตาราง person_deformed เป็น MyISAM ไม่มี transaction — รันแล้วย้อนกลับไม่ได้ " +
      "ควรสำรองตารางก่อน (เช่น CREATE TABLE person_deformed_bak_YYYYMMDD AS SELECT * FROM person_deformed;)",
    sql: DEFORMED_FIX_SQL,
    countSql: DEFORMED_COUNT_SQL,
  },
};
