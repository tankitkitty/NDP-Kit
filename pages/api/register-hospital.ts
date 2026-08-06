import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../lib/session";
import { getHospitalInfo } from "../../lib/db";
import {
  getAppVersion,
  getMachineName,
  getInstallDates,
  isRegistryEnabled,
  readConsent,
  saveConsent,
  sendToRegistry,
} from "../../lib/registry";

/**
 * แบบฟอร์มยินยอมส่งข้อมูลการใช้งาน และการรายงานไปยัง Google Sheet ของผู้พัฒนา
 *
 * ส่งเฉพาะรหัส/ชื่อสถานพยาบาล ชื่อเครื่องที่ติดตั้ง วันที่ติดตั้ง วันที่อัปเดต
 * เวอร์ชันโปรแกรม และวันเวลาที่ส่ง ตามที่ระบุไว้ในแบบฟอร์มยินยอม
 * ไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคลใดๆ
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
        preview: {
          hospitalCode: info.code,
          hospitalName: info.name,
          machineName: getMachineName(),
          ...getInstallDates(),
          version,
        },
      });
    }

    // รายงานซ้ำเงียบๆ ตามความยินยอมเดิม เฉพาะตอนที่เพิ่งอัปเดตเป็นเวอร์ชันใหม่สำเร็จ
    // เท่านั้น (เทียบกับเวอร์ชันที่เคยรายงานไว้) — ยอดแยกตามเวอร์ชันจะได้ตรงความจริง
    // ไม่ค้างอยู่ที่เวอร์ชันแรกที่ติดตั้ง
    //
    // ตั้งใจไม่รายงานเป็นระยะ ส่งเท่าที่จำเป็นจริงๆ คือตอนติดตั้งครั้งแรกกับตอนอัปเดต
    if (record.consent && version && record.version !== version) {
      try {
        const info = await getHospitalInfo();
        if (info.code) {
          await sendToRegistry({
            hospitalCode: info.code,
            hospitalName: info.name,
            machineName: getMachineName(),
            ...getInstallDates(),
            version,
            sentAt: new Date().toISOString(),
          });
          saveConsent(true, version, new Date().toISOString());
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

    // บันทึกความยินยอมก่อน แล้วตอบกลับทันที ไม่ให้ผู้ใช้ค้างรอหน้าจอ
    //
    // ยังไม่บันทึกเลขเวอร์ชันตรงนี้ เพราะยังไม่รู้ว่าส่งสำเร็จไหม การเว้นไว้ทำให้
    // เงื่อนไข "ยินยอมแล้วแต่เวอร์ชันที่รายงานไม่ตรง" ใน GET เป็นจริง ระบบจึงลอง
    // ส่งซ้ำให้เองทุกครั้งที่เปิดหน้าแรก จนกว่าจะสำเร็จ แล้วค่อยบันทึกเวอร์ชันปิดงาน
    saveConsent(true);

    void sendToRegistry({
      hospitalCode: info.code,
      hospitalName: info.name,
      machineName: getMachineName(),
      ...getInstallDates(),
      version,
      sentAt: new Date().toISOString(),
    })
      .then(() => saveConsent(true, version, new Date().toISOString()))
      .catch(() => {
        // ส่งไม่สำเร็จก็ปล่อยไว้ ไม่ต้องแจ้งผู้ใช้ เพราะจะลองใหม่ให้เองรอบหน้า
      });

    return res.status(200).json({ message: "บันทึกความยินยอมแล้ว ขอบคุณครับ" });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}
