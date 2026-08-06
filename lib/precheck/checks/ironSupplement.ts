import { createServiceCheck } from "../serviceCheck";

/**
 * บริการจ่ายยาเม็ดเสริมธาตุเหล็ก (Ferrofolic)
 *
 * เงื่อนไขการเบิกคือ ICD-10 Z130 คู่กับรายการยาที่ตั้งรหัส TMT ตรงกับที่ สปสช. กำหนด
 * ขาดอย่างใดอย่างหนึ่งก็เบิกไม่ได้
 *
 * รหัสที่ สปสช. ประกาศเป็นระดับ GPU แต่ HOSxP เก็บไว้ที่ทะเบียนยาเป็นรหัสระดับ GP
 * และ TPU ซึ่งเป็นคนละเลขกัน — ตัวสร้างกลางจะแปลงผ่านตาราง tmt_gp_to_gpu และ
 * tmt_gpu_to_tpu ให้เอง จึงใส่รหัส GPU ตามประกาศได้ตรงๆ
 *
 * ตรรกะการตรวจอยู่ใน lib/precheck/serviceCheck.ts ใช้ร่วมกับบริการอื่นที่ใช้กติกาเดียวกัน
 */
export default createServiceCheck({
  id: "iron-supplement",
  title: "บริการจ่ายยาเม็ดเสริมธาตุเหล็ก Ferrofolic (Z130 + รหัส TMT)",
  serviceName: "จ่ายยาเม็ดเสริมธาตุเหล็ก",
  icdCodes: ["Z130"],
  drugCodes: [
    "737390", // ferrous fumarate 185 mg + folic acid 400 mcg + potassium iodide 196 mcg
    "689609", // folic acid 5 mg tablet
    "855606", // ferrous sulfate 300 mg coated tablet
    "737839", // ferrous fumarate 200 mg tablet
    "715594", // ferrous fumarate 200 mg film-coated tablet
    "767382", // ferrous fumarate 200 mg coated tablet
    "776520", // ferrous sulfate 200 mg coated tablet
    "695963", // ferrous sulfate 200 mg film-coated tablet
    "1159183", // folic acid 500 mcg tablet
    "1146213", // folic acid 400 mcg tablet
  ],
  drugLabel: "ยาเม็ดเสริมธาตุเหล็ก",
  extraAdvice:
    "หมายเหตุ: รหัสยาทั้งสิบเป็นทางเลือก ไม่ต้องมีครบทุกตัว — จ่ายยาตัวใดตัวหนึ่งในรายการก็ถือว่าครบแล้ว " +
    "รหัสที่ สปสช. ประกาศเป็นระดับ GPU แต่ HOSxP เก็บไว้ในทะเบียนยาเป็นรหัส GP (ช่อง tmt_gp_code) " +
    "และ TPU (ช่อง sks_drug_code / tmt_tp_code) ซึ่งเป็นคนละเลขกัน ระบบแปลงให้อัตโนมัติแล้ว " +
    "ตารางรายการยาด้านล่างจึงแสดงเลขที่ตั้งไว้จริงในฐาน ไม่ใช่เลข GPU ตามประกาศ",
});
