import { NextApiRequest, NextApiResponse } from "next";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/session";

const EDITABLE_FIELDS = [
  "vn",
  "hn",
  "eclaim_fee_schedule_req_date",
  "eclaim_fee_schedule_req",
  "eclaim_fee_schedule_resp",
  "eclaim_fee_schedule_status",
  "claim_staff",
  "nhso_id",
  "nhso_seq",
  "eclaim_fee_schedule_check_req",
  "rep_eclaim_detail_error_code",
  "rep_eclaim_detail_rep_no",
  "nhso_uid",
  "nhso_record_status",
  "nhso_payment_status",
  "nhso_run_date",
  "nhso_budget_no",
  "nhso_book_date",
  "nhso_doc_no",
  "nhso_rep_no",
  "nhso_period",
  "nhso_message",
  "nhso_btch_no",
  "nhso_source_channel",
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "id ไม่ถูกต้อง" });
  }

  if (req.method === "GET") {
    try {
      const rows: any = await query(
        "SELECT * FROM eclaim_fee_schedule WHERE eclaim_fee_schedule_id = ? LIMIT 1",
        [id]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: "ไม่พบข้อมูล" });
      }
      return res.status(200).json({ row: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถโหลดข้อมูลได้" });
    }
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        const value = body[field];
        setClauses.push(`${field} = ?`);
        values.push(value === "" ? null : value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "ไม่มีข้อมูลให้บันทึก" });
    }

    setClauses.push("last_update = NOW()");

    try {
      await query(
        `UPDATE eclaim_fee_schedule SET ${setClauses.join(", ")} WHERE eclaim_fee_schedule_id = ?`,
        [...values, id]
      );
      const rows: any = await query(
        "SELECT * FROM eclaim_fee_schedule WHERE eclaim_fee_schedule_id = ? LIMIT 1",
        [id]
      );
      return res.status(200).json({ row: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const rows: any = await query(
        "SELECT eclaim_fee_schedule_id FROM eclaim_fee_schedule WHERE eclaim_fee_schedule_id = ? LIMIT 1",
        [id]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: "ไม่พบข้อมูล" });
      }

      await query("DELETE FROM eclaim_fee_schedule WHERE eclaim_fee_schedule_id = ?", [id]);
      return res.status(200).json({ message: "ลบข้อมูลสำเร็จ" });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถลบข้อมูลได้" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  res.status(405).end("Method Not Allowed");
}
