import { createServiceCheck } from "../serviceCheck";

/**
 * บริการตรวจหลังคลอด (4-ANC-PNC : Postnatal Care)
 *
 * ต้องมีทั้ง ICD-10 Z390/Z391/Z392 และรายการค่าบริการที่ผูกรหัส ADP 30015
 * ตรรกะการตรวจอยู่ใน lib/precheck/serviceCheck.ts เพราะใช้ร่วมกับบริการอื่นที่ใช้
 * กติกาเดียวกัน (เช่น ค่ายา Triferdine)
 */
export default createServiceCheck({
  id: "postnatal-care",
  title: "บริการตรวจหลังคลอด (ICD-10 Z39 + ADP 30015)",
  serviceName: "ตรวจหลังคลอด",
  icdCodes: ["Z390", "Z391", "Z392"],
  adpCodes: ["30015"],
});
