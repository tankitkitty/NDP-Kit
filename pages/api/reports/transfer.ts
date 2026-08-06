import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { getHospitalInfo } from "../../../lib/db";
import { UnsafeSqlError } from "../../../lib/reports/guard";
import { importBundle, loadReports } from "../../../lib/reports/store";
import { BUNDLE_FORMAT, BUNDLE_VERSION, ReportBundle } from "../../../lib/reports/types";

/**
 * ส่งต่อรายงานระหว่างหน่วยบริการ
 *   GET  ?ids=a,b   — ดาวน์โหลดไฟล์ .json ของรายงานที่เลือก (ไม่ระบุ = ทั้งหมด)
 *   POST { bundle } — นำเข้าไฟล์ที่หน่วยอื่นส่งมา
 *
 * ไฟล์ที่ส่งออกมีแต่ "คำสั่ง" ไม่มีผลลัพธ์ จึงไม่มีข้อมูลผู้ป่วยติดไปด้วย
 * (ผลลัพธ์ที่มีข้อมูลผู้ป่วยอยู่ในไฟล์ Excel ซึ่งเป็นคนละปุ่มกัน)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method === "GET") {
    const idsRaw = typeof req.query.ids === "string" ? req.query.ids : "";
    const wanted = idsRaw ? new Set(idsRaw.split(",").filter(Boolean)) : null;
    const reports = loadReports().filter((r) => (wanted ? wanted.has(r.id) : true));

    if (reports.length === 0) {
      return res.status(400).json({ error: "ไม่มีรายงานให้ส่งออก" });
    }

    const hospital = await getHospitalInfo().catch(() => ({ code: "", name: "" }));
    const bundle: ReportBundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: hospital.name || session.loginname,
      reports,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const name = `รายงาน NDP-Kit ${stamp}`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ndp-kit-reports.json"; filename*=UTF-8''${encodeURIComponent(name)}.json`
    );
    return res.status(200).send(JSON.stringify(bundle, null, 2));
  }

  if (req.method === "POST") {
    try {
      const bundle = req.body?.bundle ?? req.body;
      if (bundle?.format && bundle.format !== BUNDLE_FORMAT) {
        return res.status(400).json({ error: "ไฟล์นี้ไม่ใช่ไฟล์รายงานของ NDP-Kit" });
      }
      const result = importBundle(bundle, session.loginname);
      return res.status(200).json(result);
    } catch (error: any) {
      const status = error instanceof UnsafeSqlError ? 400 : 500;
      return res.status(status).json({ error: error?.message || "นำเข้าไม่สำเร็จ" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end("Method Not Allowed");
}
