import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { query, ensurePttypeEditLogTable, pruneOldPttypeEditLogs } from "../../../lib/db";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optStr(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

function optDate(value: unknown): string | null {
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null;
}

// แปลงค่าวันที่จากฐาน (JS Date หรือ string) เป็น 'YYYY-MM-DD' สำหรับ log
function toYMD(value: any): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  // ---- GET: ดึงข้อมูลสิทธิ (visit_pttype) ของ vn+pttype มาแก้ไข ----
  if (req.method === "GET") {
    const vn = optStr(req.query.vn, 13);
    const pttype = optStr(req.query.pttype, 2);
    if (!vn || !pttype) {
      return res.status(400).json({ error: "ต้องระบุ vn และ pttype" });
    }
    try {
      const rows: any = await query(
        `SELECT vp.vn, vp.pttype, vp.pttypeno,
                TRIM(REPLACE(REPLACE(vp.auth_code, CHAR(9), ''), CHAR(10), '')) AS auth_code,
                vp.hospmain, vp.hospsub,
                DATE_FORMAT(vp.begin_date, '%Y-%m-%d') AS begin_date,
                DATE_FORMAT(vp.expire_date, '%Y-%m-%d') AS expire_date,
                pt.name AS pttype_name
         FROM visit_pttype vp
         LEFT JOIN pttype pt ON pt.pttype = vp.pttype
         WHERE vp.vn = ? AND vp.pttype = ? LIMIT 1`,
        [vn, pttype]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "ไม่พบสิทธิของ visit นี้" });
      }
      // ดึงประวัติการแก้ไข (log สำรอง) ของ vn นี้มาแสดงด้วย
      let history: any[] = [];
      try {
        await ensurePttypeEditLogTable();
        await pruneOldPttypeEditLogs();
        history = (await query(
          `SELECT id, pttype_before, pttype_after, auth_code_before, auth_code_after, edited_by, edited_at
           FROM pttype_edit_log WHERE vn = ? ORDER BY edited_at DESC LIMIT 10`,
          [vn]
        )) as any[];
      } catch {
        history = [];
      }
      return res.status(200).json({ row: rows[0], history });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "ไม่สามารถโหลดข้อมูลได้" });
    }
  }

  // ---- POST: อัปเดต visit_pttype (เฉพาะแถวที่มีอยู่ ไม่เพิ่มใหม่) ----
  if (req.method === "POST") {
    const body = req.body || {};
    const vn = optStr(body.vn, 13);
    const originalPttype = optStr(body.originalPttype, 2);
    const pttype = optStr(body.pttype, 2);
    if (!vn || !originalPttype || !pttype) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี vn และ pttype)" });
    }

    const authCode = optStr(body.auth_code, 15);
    const hospmain = optStr(body.hospmain, 9);
    const hospsub = optStr(body.hospsub, 9);
    const beginDate = optDate(body.begin_date);
    const expireDate = optDate(body.expire_date);

    try {
      // ยืนยันว่าแถวมีอยู่จริง + เก็บค่าเดิม "ทั้งแถว" ไว้ทำ log สำรอง (กู้คืนได้)
      const existing: any = await query(
        "SELECT * FROM visit_pttype WHERE vn = ? AND pttype = ? LIMIT 1",
        [vn, originalPttype]
      );
      if (!existing.length) {
        return res.status(404).json({ error: "ไม่พบสิทธิของ visit นี้ใน HOSxP (ไม่ได้เพิ่มแถวใหม่)" });
      }
      const before = existing[0];

      // ถ้าเปลี่ยน pttype ไปตรงกับสิทธิที่ visit นี้มีอยู่แล้ว จะชนกับ PK (vn,pttype)
      if (pttype !== originalPttype) {
        const clash: any = await query(
          "SELECT vn FROM visit_pttype WHERE vn = ? AND pttype = ? LIMIT 1",
          [vn, pttype]
        );
        if (clash.length) {
          return res.status(409).json({ error: `visit นี้มีสิทธิรหัส ${pttype} อยู่แล้ว` });
        }
      }

      // บันทึก log สำรอง "ก่อน" เขียนทับ HOSxP (สำคัญ เพราะ MyISAM ย้อนกลับไม่ได้)
      try {
        await ensurePttypeEditLogTable();
        await query(
          `INSERT INTO pttype_edit_log
            (vn, pttype_before, pttype_after, auth_code_before, auth_code_after,
             hospmain_before, hospmain_after, hospsub_before, hospsub_after,
             begin_date_before, begin_date_after, expire_date_before, expire_date_after,
             full_before, edited_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            vn,
            before.pttype ?? null,
            pttype,
            before.auth_code ?? null,
            authCode,
            before.hospmain ?? null,
            hospmain,
            before.hospsub ?? null,
            hospsub,
            toYMD(before.begin_date),
            beginDate,
            toYMD(before.expire_date),
            expireDate,
            JSON.stringify(before),
            session.loginname,
          ]
        );
      } catch (logError) {
        // ถ้าเขียน log ไม่ได้ ให้หยุด ไม่แก้ HOSxP (กันแก้โดยไม่มีสำรอง)
        return res.status(500).json({ error: "ไม่สามารถบันทึก log สำรองได้ จึงไม่ดำเนินการแก้ไข HOSxP เพื่อความปลอดภัย" });
      }

      // ลบ log ที่เกิน 90 วันทิ้งอัตโนมัติ (ไม่ให้กระทบการแก้ไขหลักถ้าลบไม่สำเร็จ)
      pruneOldPttypeEditLogs().catch(() => undefined);

      await query(
        `UPDATE visit_pttype
         SET pttype = ?, auth_code = ?, hospmain = ?, hospsub = ?, begin_date = ?, expire_date = ?, update_datetime = NOW()
         WHERE vn = ? AND pttype = ?`,
        [pttype, authCode, hospmain, hospsub, beginDate, expireDate, vn, originalPttype]
      );

      return res.status(200).json({ message: "อัปเดตสิทธิใน HOSxP สำเร็จ (บันทึก log สำรองแล้ว)" });
    } catch (error: any) {
      const msg = error?.code === "ER_DUP_ENTRY" ? "สิทธิรหัสนี้มีอยู่แล้วใน visit นี้" : error?.message || "ไม่สามารถอัปเดตได้";
      return res.status(500).json({ error: msg });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end("Method Not Allowed");
}
