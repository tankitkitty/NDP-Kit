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
    // ดึงผู้ป่วย OPD (ovst + patient) พร้อมสถานะสิทธิที่ HOSxP บันทึกไว้แล้ว
    // จาก visit_pttype: auth_code = รหัสยืนยันสิทธิจากการตรวจสอบกับ สปสช.
    // (ถ้ามีค่า = ตรวจสอบสิทธิแล้ว) และ pttype -> ชื่อสิทธิจากตาราง pttype
    // รวม visit_pttype ด้วย GROUP BY vn กันแถวซ้ำ (1 visit อาจมีหลาย pttype)
    const visits: any = await query(
      `SELECT
        o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate, o.vsttime,
        p.cid,
        TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patient_name,
        vp.auth_code,
        vp.pttype,
        DATE_FORMAT(vp.expire_date, '%Y-%m-%d') AS pttype_expire,
        pt.name AS pttype_name
      FROM ovst o
      LEFT JOIN patient p ON p.hn = o.hn
      LEFT JOIN (
        SELECT vn,
          MAX(NULLIF(TRIM(REPLACE(REPLACE(auth_code, CHAR(9), ''), CHAR(10), '')), '')) AS auth_code,
          SUBSTRING_INDEX(
            GROUP_CONCAT(pttype ORDER BY (auth_code IS NOT NULL AND TRIM(auth_code) <> '') DESC, pttype_number),
            ',', 1
          ) AS pttype,
          MAX(expire_date) AS expire_date
        FROM visit_pttype
        GROUP BY vn
      ) vp ON vp.vn = o.vn
      LEFT JOIN pttype pt ON pt.pttype = vp.pttype
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
    return res.status(500).json({ error: error?.message || "ไม่สามารถโหลดข้อมูลได้ (ตรวจสอบว่าฐาน pcu มีตาราง ovst/patient/visit_pttype/pttype ตามที่คาดไว้หรือไม่)" });
  }
}
