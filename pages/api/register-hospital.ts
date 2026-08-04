import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../lib/session";
import { getHospitalInfo } from "../../lib/db";
import {
  getAppVersion,
  isRegistryEnabled,
  markAnswered,
  readAnswered,
  sendToRegistry,
} from "../../lib/registry";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ถามหลังตั้งค่าเสร็จแล้วเท่านั้น ตอนนั้นเจ้าหน้าที่เข้าสู่ระบบได้แล้ว
  // จึงบังคับ session เต็มรูปแบบ ไม่รับรหัสติดตั้งครั้งแรก
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (!isRegistryEnabled()) {
    return res.status(200).json({ shouldAsk: false });
  }

  if (req.method === "GET") {
    const answered = readAnswered();
    const version = getAppVersion();

    if (!answered) {
      const info = await getHospitalInfo();
      return res.status(200).json({
        shouldAsk: true,
        preview: {
          hospitalCode: info.code,
          hospitalName: info.name,
          version,
        },
      });
    }

    // เคยยินยอมไว้แล้วและเพิ่งอัปเดตเป็นเวอร์ชันใหม่ → ส่งข้อมูลชุดเดิมซ้ำเงียบๆ
    // เพื่อให้คอลัมน์เวอร์ชันในชีตตรงกับความจริงเสมอ ไม่ต้องถามผู้ใช้ซ้ำเพราะ
    // เป็นข้อมูลชุดเดียวกับที่เคยอนุญาตไปแล้ว ไม่ได้เพิ่มอะไรใหม่
    // ถ้าเคยปฏิเสธ (sent = false) จะไม่ส่งอะไรอีกเลยตลอดไป
    if (answered.sent && version && answered.version !== version) {
      try {
        const info = await getHospitalInfo();
        // ไม่มีรหัสสถานพยาบาล (ฐานข้อมูลล่ม หรือ opdconfig ไม่มีค่า) ให้ข้ามไปก่อน
        // ถ้าส่งไปทั้งที่รหัสว่าง แถวนั้นจะไปทับกับหน่วยอื่นที่รหัสว่างเหมือนกัน
        // เพราะสคริปต์ฝั่งชีตใช้รหัสเป็นตัวเทียบว่าเป็นหน่วยเดียวกันหรือไม่
        if (!info.code) {
          return res.status(200).json({ shouldAsk: false });
        }
        await sendToRegistry({
          hospitalCode: info.code,
          hospitalName: info.name,
          version,
          sentAt: new Date().toISOString(),
        });
        markAnswered(true, version);
      } catch {
        // ส่งไม่ได้ก็ไม่บันทึกเวอร์ชัน จะได้ลองใหม่คราวหน้าที่เปิดโปรแกรม
      }
    }

    return res.status(200).json({ shouldAsk: false });
  }

  if (req.method === "POST") {
    const version = getAppVersion();

    if (req.body?.consent !== true) {
      markAnswered(false, version);
      return res.status(200).json({ message: "รับทราบ จะไม่ถามอีก" });
    }

    const info = await getHospitalInfo();
    if (!info.code) {
      return res.status(400).json({
        error:
          "ไม่พบรหัสสถานพยาบาลในฐานข้อมูล (ตาราง opdconfig) กรุณาตรวจสอบการเชื่อมต่อฐานข้อมูลก่อน",
      });
    }
    try {
      await sendToRegistry({
        hospitalCode: info.code,
        hospitalName: info.name,
        version,
        sentAt: new Date().toISOString(),
      });
      markAnswered(true, version);
      return res.status(200).json({ message: "ส่งข้อมูลลงทะเบียนเรียบร้อย ขอบคุณครับ" });
    } catch (error: any) {
      // ไม่บันทึกว่าตอบแล้ว เพื่อให้กดส่งซ้ำได้เมื่อเน็ตกลับมา
      return res
        .status(502)
        .json({ error: `ส่งข้อมูลไม่สำเร็จ: ${error?.message || "เชื่อมต่อปลายทางไม่ได้"}` });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}
