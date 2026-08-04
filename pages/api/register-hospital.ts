import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../lib/session";
import { getHospitalInfo } from "../../lib/db";
import {
  getAppVersion,
  hasAnswered,
  isRegistryEnabled,
  markAnswered,
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
    if (hasAnswered()) return res.status(200).json({ shouldAsk: false });
    const info = await getHospitalInfo();
    return res.status(200).json({
      shouldAsk: true,
      preview: {
        hospitalCode: info.code,
        hospitalName: info.name,
        version: getAppVersion(),
      },
    });
  }

  if (req.method === "POST") {
    if (req.body?.consent !== true) {
      markAnswered(false);
      return res.status(200).json({ message: "รับทราบ จะไม่ถามอีก" });
    }

    const info = await getHospitalInfo();
    try {
      await sendToRegistry({
        hospitalCode: info.code,
        hospitalName: info.name,
        version: getAppVersion(),
        sentAt: new Date().toISOString(),
      });
      markAnswered(true);
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
