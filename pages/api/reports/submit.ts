import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { getHospitalName } from "../../../lib/db";
import { isAdminMode } from "../../../lib/reports/admin";
import { findReport } from "../../../lib/reports/registry";
import { findExistingBuiltin, isSubmitConfigured, submitReport } from "../../../lib/reports/submit";

/**
 * ส่งคำขอสร้าง/แก้ไขรายงานไปยังส่วนกลาง
 *
 * เฉพาะเครื่องที่เปิดโหมดผู้ดูแล เพราะเป็นเครื่องของผู้ช่วยที่เขียน query
 * เครื่องหน่วยบริการทั่วไปไม่มีเหตุต้องส่งอะไรออกไป
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });

  if (!isAdminMode(req)) {
    return res.status(403).json({ error: "เครื่องนี้ไม่ได้เปิดโหมดผู้ดูแล" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  if (!isSubmitConfigured()) {
    return res.status(400).json({
      error: "เครื่องนี้ยังไม่ได้ตั้งค่าที่อยู่ส่วนกลาง — ต้องมีไฟล์ data\\report-inbox.json",
    });
  }

  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const report = findReport(id);
  if (!report) return res.status(404).json({ error: "ไม่พบรายงานที่จะส่ง" });

  // รายงานที่มากับโปรแกรมอยู่แล้วไม่ต้องส่งซ้ำ ถ้าจะแก้ต้องบอกว่าเป็นการขอแก้
  const wantsRevision = req.body?.kind === "revision";
  const existing = findExistingBuiltin(report.name);
  if (existing && !wantsRevision) {
    return res.status(409).json({
      error: `มีรายงานชื่อ "${existing.name}" อยู่ในระบบแล้ว ถ้าต้องการแก้ให้กดขอแก้ไขแทน`,
      existingId: existing.id,
    });
  }

  try {
    const hospital = await getHospitalName();
    const result = await submitReport({
      report,
      kind: wantsRevision ? "revision" : "new",
      targetId: existing?.id || "",
      sender: session.loginname,
      hospital,
      note: typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : "",
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "ส่งคำขอไม่สำเร็จ" });
  }
}
