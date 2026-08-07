import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { UnsafeSqlError } from "../../../lib/reports/guard";
import { isAdminMode } from "../../../lib/reports/admin";
import { isBuiltinId } from "../../../lib/reports/builtin";
import { allReports } from "../../../lib/reports/registry";
import { deleteReport, upsertReport } from "../../../lib/reports/store";

/**
 * ทะเบียนรายงาน
 *   GET    — รายการทั้งหมด (ที่ติดมากับโปรแกรม + ที่เขียนเองในเครื่อง)
 *   POST   — สร้างใหม่ หรือแก้ของเดิม (ส่ง id มาด้วย) — เฉพาะเครื่องผู้ดูแล
 *   DELETE — ลบตาม ?id= — เฉพาะเครื่องผู้ดูแล
 *
 * การบันทึกไม่ได้แตะฐานข้อมูล HOSxP เลย เก็บลงไฟล์ใน data/ อย่างเดียว
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  const admin = isAdminMode(req);

  if (req.method === "GET") {
    return res.status(200).json({ reports: allReports(), admin });
  }

  // ต้องกันที่ API ด้วย ไม่ใช่ซ่อนแค่ปุ่มบนหน้าเว็บ เพราะปุ่มที่ซ่อนไว้ไม่ได้กันใคร
  // ที่ยิงคำขอเข้ามาตรงๆ ได้
  if (req.method === "POST" || req.method === "DELETE") {
    if (!admin) {
      return res.status(403).json({
        error: "เครื่องนี้ไม่ได้เปิดโหมดผู้ดูแล จึงเพิ่มหรือแก้รายงานไม่ได้",
      });
    }
  }

  if (req.method === "POST") {
    try {
      const report = upsertReport(req.body, session.loginname);
      return res.status(200).json({ report });
    } catch (error: any) {
      const status = error instanceof UnsafeSqlError ? 400 : 500;
      return res.status(status).json({ error: error?.message || "บันทึกไม่สำเร็จ" });
    }
  }

  if (req.method === "DELETE") {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id) return res.status(400).json({ error: "ไม่ได้ระบุรายงานที่จะลบ" });
    // รายงานที่ติดมากับโปรแกรมไม่ได้เก็บในไฟล์ของเครื่องนี้ ลบไปก็กลับมาตอนเปิดใหม่
    // บอกให้ตรงดีกว่าปล่อยให้ลบแล้วงงว่าทำไมยังอยู่
    if (isBuiltinId(id)) {
      return res.status(400).json({
        error: "รายงานที่มากับโปรแกรมลบไม่ได้ ต้องแก้ที่โค้ดแล้วปล่อยเวอร์ชันใหม่",
      });
    }
    if (!deleteReport(id)) return res.status(404).json({ error: "ไม่พบรายงานนี้" });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end("Method Not Allowed");
}
