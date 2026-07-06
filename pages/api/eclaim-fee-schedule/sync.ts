import { NextApiRequest, NextApiResponse } from "next";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/session";
import { getStatusTrackDetails } from "../../../lib/nhso";

const CHUNK_SIZE = 20;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];

  if (ids.length === 0) {
    return res.status(400).json({ error: "ไม่มีรายการให้ซิงค์" });
  }

  try {
    const rows: any = await query(
      `SELECT eclaim_fee_schedule_id, nhso_uid FROM eclaim_fee_schedule WHERE eclaim_fee_schedule_id IN (${ids
        .map(() => "?")
        .join(",")})`,
      ids
    );

    const withUid = rows.filter((r: any) => r.nhso_uid);
    const uidToId = new Map<string, number>();
    withUid.forEach((r: any) => uidToId.set(r.nhso_uid, r.eclaim_fee_schedule_id));

    let updated = 0;
    const errors: string[] = [];

    for (const batch of chunk(Array.from(uidToId.keys()), CHUNK_SIZE)) {
      try {
        const results = await getStatusTrackDetails(batch);
        for (const result of results) {
          const id = uidToId.get(result.uid);
          if (!id) continue;

          const statement = result.statements?.[0];
          const budgetNo = statement?.subFundInfo?.[0]?.budgetNo || null;
          const message = result.status ? `[${result.status.code}] ${result.status.message}` : null;

          await query(
            `UPDATE eclaim_fee_schedule SET
              nhso_record_status = ?,
              nhso_message = ?,
              rep_eclaim_detail_error_code = ?,
              nhso_run_date = ?,
              nhso_btch_no = ?,
              nhso_period = ?,
              nhso_doc_no = ?,
              nhso_rep_no = ?,
              nhso_budget_no = ?,
              eclaim_fee_schedule_resp = ?,
              last_update = NOW()
            WHERE eclaim_fee_schedule_id = ?`,
            [
              result.recordStatus || null,
              message,
              result.results ? JSON.stringify(result.results) : null,
              statement?.runDatetime || null,
              statement?.batchNo || null,
              statement?.period || null,
              statement?.docNo || null,
              statement?.reportNo || null,
              budgetNo,
              JSON.stringify(result),
              id,
            ]
          );
          updated += 1;
        }
      } catch (batchError: any) {
        errors.push(batchError?.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ NHSO");
      }
    }

    return res.status(200).json({
      message: `ซิงค์สำเร็จ ${updated} จาก ${withUid.length} รายการที่มี NHSO UID`,
      updated,
      requested: ids.length,
      skipped: ids.length - withUid.length,
      errors,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถซิงค์ข้อมูลได้" });
  }
}
