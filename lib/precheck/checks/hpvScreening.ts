import { createServiceCheck } from "../serviceCheck";

/**
 * บริการคัดกรองมะเร็งปากมดลูก HPV — ค่าเก็บตัวอย่าง
 *
 * ต้องครบสามอย่างในเคสเดียวกัน คือ ICD-10 Z115 (คัดกรองมะเร็งปากมดลูก),
 * ICD-9-CM 9146 (หัตถการเก็บตัวอย่าง) และรายการค่าบริการรหัส CSMBS 38608
 *
 * ตรรกะการตรวจอยู่ใน lib/precheck/serviceCheck.ts ใช้ร่วมกับบริการอื่นที่ใช้กติกาเดียวกัน
 */
export default createServiceCheck({
  id: "hpv-screening",
  title: "คัดกรองมะเร็งปากมดลูก HPV ค่าเก็บตัวอย่าง (Z115 + 9146 + 38608)",
  serviceName: "คัดกรองมะเร็งปากมดลูก HPV (ค่าเก็บตัวอย่าง)",
  icdCodes: ["Z115"],
  icd9Codes: ["9146"],
  billCodes: ["38608"],
  adpLabel: "CSMBS 38608",
});
