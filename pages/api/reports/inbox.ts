import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { isAdminMode } from "../../../lib/reports/admin";
import {
  canCreateBuiltin,
  createBuiltinFromRequest,
  listInbox,
  loadRequest,
} from "../../../lib/reports/inbox";

/**
 * กล่องรับคำขอสร้างรายงานจากผู้ช่วย
 *   GET  — รายการคำขอทั้งหมดพร้อมผลตรวจ
 *   POST — สร้างเป็นรายงานติดโปรแกรม (ส่ง fileId + fileName + group)
 *
 * เฉพาะเครื่องผู้ดูแล เพราะการสร้างรายงานคือการเขียนไฟล์ซอร์สโค้ดของโปรแกรม
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  if (!isAdminMode(req)) {
    return res.status(403).json({ error: "เครื่องนี้ไม่ได้เปิดโหมดผู้ดูแล" });
  }

  if (req.method === "GET") {
    try {
      const files = await listInbox();
      // โหลดทีละใบแบบขนาน แต่ใบที่พังไม่ควรทำให้ทั้งรายการหาย
      const requests = await Promise.all(
        files.map(async (f) => {
          try {
            return await loadRequest(f.fileId, f.fileName);
          } catch (error: any) {
            return {
              fileId: f.fileId,
              fileName: f.fileName,
              kind: "new" as const,
              targetId: "",
              sender: "",
              hospital: "",
              note: "",
              submittedAt: "",
              name: f.fileName,
              group: "",
              description: "",
              sql: "",
              params: [],
              problems: [error?.message || "อ่านไฟล์นี้ไม่ได้"],
            };
          }
        })
      );
      return res.status(200).json({ requests, canCreate: canCreateBuiltin() });
    } catch (error: any) {
      return res.status(502).json({
        error: `อ่านกล่องรับคำขอไม่สำเร็จ: ${error?.message || "เชื่อมต่อ Google Drive ไม่ได้"}`,
      });
    }
  }

  if (req.method === "POST") {
    const fileId = typeof req.body?.fileId === "string" ? req.body.fileId : "";
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
    const group = typeof req.body?.group === "string" ? req.body.group.trim().slice(0, 60) : "";
    if (!fileId) return res.status(400).json({ error: "ไม่ได้ระบุคำขอ" });

    try {
      // โหลดใหม่จากต้นทางเสมอ ไม่เชื่อข้อมูลที่เบราว์เซอร์ส่งกลับมา
      const request = await loadRequest(fileId, fileName);
      const created = createBuiltinFromRequest(request, group);
      return res.status(200).json({ ok: true, ...created });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "สร้างรายงานไม่สำเร็จ" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end("Method Not Allowed");
}
