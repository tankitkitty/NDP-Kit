import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../lib/session";
import { buildDashboard } from "../../lib/dashboard";

/**
 * ตัวเลขสรุปสำหรับ dashboard หน้าแรก
 *
 * แยกเป็น API ให้หน้าเว็บเรียกหลังโหลดเสร็จ ไม่ทำใน getServerSideProps
 * เพราะหน้าแรกต้องขึ้นทันที ไม่ควรรอฐานข้อมูลตอบก่อนถึงจะเห็นอะไรเลย
 * และเครื่องที่ยังไม่ได้ตั้งค่าฐานจะเปิดหน้าแรกไม่ได้ทั้งหน้า
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    return res.status(200).json(await buildDashboard());
  } catch (error: any) {
    return res.status(502).json({
      error: `อ่านข้อมูลสรุปไม่สำเร็จ: ${error?.message || "เชื่อมต่อฐานข้อมูลไม่ได้"}`,
    });
  }
}
