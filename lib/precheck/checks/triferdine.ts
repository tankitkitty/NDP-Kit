import { createServiceCheck } from "../serviceCheck";

/**
 * บริการจ่ายยา Triferdine (4-ANC-PNC : Postnatal Care)
 *
 * ต้องครบสามอย่างในเคสเดียวกัน คือ ICD-10 Z392, ค่าบริการรหัส ADP 30016
 * และรายการยาที่ตั้งรหัสยา 737390 หรือ 689609 (Triferdine 150)
 * ตรรกะการตรวจอยู่ใน lib/precheck/serviceCheck.ts ใช้ร่วมกับบริการตรวจหลังคลอด
 */
export default createServiceCheck({
  id: "triferdine",
  title: "บริการจ่ายยา Triferdine (ICD-10 Z392 + ADP 30016)",
  serviceName: "จ่ายยา Triferdine",
  icdCodes: ["Z392"],
  adpCodes: ["30016"],
  drugCodes: ["737390", "689609"],
  drugName: "Triferdine",
  extraAdvice:
    "หมายเหตุ: รหัส ADP 30016 เบิกได้ครั้งละ 90 เม็ด ไม่เกิน 2 ครั้งต่อการตั้งครรภ์ 1 ครั้ง " +
    "เคสที่คีย์เกินเงื่อนไขนี้จะถูกตัดยอดแม้ข้อมูลจะครบตามที่ตรวจในตารางแล้วก็ตาม",
});
