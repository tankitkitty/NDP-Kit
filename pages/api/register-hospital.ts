import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../lib/session";
import { getHospitalInfo } from "../../lib/db";
import {
  getAppVersion,
  isRegistryEnabled,
  readConsent,
  saveConsent,
  sendToRegistry,
} from "../../lib/registry";

/**
 * แบบฟอร์มยินยอมส่งข้อมูลการใช้งาน และการรายงานไปยัง Google Sheet ของผู้พัฒนา
 *
 * ส่งเฉพาะ "รหัสสถานบริการ" กับ "เวอร์ชันโปรแกรม" ตามที่ระบุไว้ในแบบฟอร์ม
 * ไม่มีข้อมูลผู้ป่วย ข้อมูลส่วนบุคคล หรือแม้แต่ชื่อสถานพยาบาล
 *
 * GET  -> บอกว่าต้องแสดงแบบฟอร์มไหม และถ้ายินยอมไว้แล้วกับเพิ่งอัปเดตเวอร์ชัน
 *         จะรายงานเวอร์ชันใหม่ให้เงียบๆ ตามความยินยอมเดิม
 * POST -> บันทึกคำตอบจากแบบฟอร์ม ถ้ายินยอมก็ส่งข้อมูลทันที
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ต้องเข้าสู่ระบบก่อน ซึ่งแปลว่าตั้งค่าฐานข้อมูล HOSxP สำเร็จแล้วโดยปริยาย
  // เพราะการล็อกอินอ่านบัญชีเจ้าหน้าที่จากตาราง officer ในฐานข้อมูลนั้น
  // และรหัสสถานบริการก็อ่านจากฐานเดียวกัน ก่อนหน้านี้จึงยังส่งอะไรไม่ได้อยู่ดี
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (!isRegistryEnabled()) {
    return res.status(200).json({ needConsent: false });
  }

  const version = getAppVersion();
  const record = readConsent();

  if (req.method === "GET") {
    if (!record) {
      const info = await getHospitalInfo();
      return res.status(200).json({
        needConsent: true,
        preview: { hospitalCode: info.code, version },
      });
    }

    // ยินยอมไว้แล้วและเพิ่งอัปเดตเป็นเวอร์ชันใหม่ → รายงานซ้ำเงียบๆ ตามความยินยอมเดิม
    // เพื่อให้ยอดการใช้งานแยกตามเวอร์ชันตรงกับความจริง ไม่ใช่ค้างอยู่ที่เวอร์ชันแรก
    if (record.consent && version && record.version !== version) {
      try {
        const info = await getHospitalInfo();
        if (info.code) {
          await sendToRegistry({ hospitalCode: info.code, version });
          saveConsent(true, version);
        }
      } catch {
        // ส่งไม่ได้ก็ไม่บันทึกเวอร์ชัน จะได้ลองใหม่คราวหน้าที่เปิดโปรแกรม
      }
    }

    return res.status(200).json({ needConsent: false });
  }

  if (req.method === "POST") {
    if (req.body?.consent !== true) {
      saveConsent(false);
      return res.status(200).json({ message: "รับทราบ จะไม่ส่งข้อมูลใดๆ" });
    }

    const info = await getHospitalInfo();
    if (!info.code) {
      return res.status(400).json({
        error: "ไม่พบรหัสสถานบริการในฐานข้อมูล (ตาราง opdconfig) กรุณาตรวจสอบการเชื่อมต่อก่อน",
      });
    }

    try {
      await sendToRegistry({ hospitalCode: info.code, version });
      saveConsent(true, version);
      return res.status(200).json({ message: "ขอบคุณครับ ส่งข้อมูลเรียบร้อยแล้ว" });
    } catch (error: any) {
      return res.status(502).json({
        error: `ส่งข้อมูลไม่สำเร็จ: ${error?.message || "เชื่อมต่อปลายทางไม่ได้"}`,
      });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}
