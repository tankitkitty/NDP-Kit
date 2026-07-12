import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { query, ensureEligibilityCheckTable } from "../../../lib/db";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  const from = typeof req.query.from === "string" && DATE_PATTERN.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && DATE_PATTERN.test(req.query.to) ? req.query.to : null;
  if (!from || !to) {
    return res.status(400).json({ error: "กรุณาระบุช่วงวันที่ให้ถูกต้อง" });
  }

  try {
    // สมมติฐานโครงสร้างฐาน pcu (HOSxP): ตาราง ovst (Out-patient visit) + patient
    // หากชื่อตาราง/คอลัมน์ในระบบจริงต่างจากนี้ ให้แจ้งเพื่อแก้ไขจุดนี้
    const visits: any = await query(
      `SELECT
        o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate, o.vsttime,
        p.cid,
        TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patient_name
      FROM ovst o
      LEFT JOIN patient p ON p.hn = o.hn
      WHERE o.vstdate BETWEEN ? AND ?
      ORDER BY o.vstdate DESC, o.vn DESC
      LIMIT ${MAX_ROWS}`,
      [from, to]
    );

    await ensureEligibilityCheckTable();

    const history: any = visits.length
      ? await query(
          `SELECT vn, status, claim_type, claim_code, checked_at
           FROM eligibility_check
           WHERE visit_date BETWEEN ? AND ?
           ORDER BY checked_at DESC`,
          [from, to]
        )
      : [];

    const latestByVn = new Map<string, any>();
    for (const h of history) {
      if (!latestByVn.has(h.vn)) latestByVn.set(h.vn, h);
    }

    const rows = visits.map((v: any) => ({
      ...v,
      lastCheck: latestByVn.get(v.vn) || null,
    }));

    return res.status(200).json({ rows, truncated: visits.length >= MAX_ROWS });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถโหลดข้อมูลได้ (ตรวจสอบว่าฐาน pcu มีตาราง ovst/patient ตามที่คาดไว้หรือไม่)" });
  }
}
