import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { UnsafeSqlError } from "../../../lib/reports/guard";
import { deleteReport, loadReports, upsertReport } from "../../../lib/reports/store";

/**
 * ทะเบียนรายงานที่ผู้ใช้เขียนเอง
 *   GET    — รายการรายงานทั้งหมด
 *   POST   — สร้างใหม่ หรือแก้ของเดิม (ส่ง id มาด้วย)
 *   DELETE — ลบตาม ?id=
 *
 * การบันทึกไม่ได้แตะฐานข้อมูล HOSxP เลย เก็บลงไฟล์ data/reports.json อย่างเดียว
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ reports: loadReports() });
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
    if (!deleteReport(id)) return res.status(404).json({ error: "ไม่พบรายงานนี้" });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end("Method Not Allowed");
}
