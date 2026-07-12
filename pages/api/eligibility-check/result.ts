import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { query, ensureEligibilityCheckTable } from "../../../lib/db";
import { DAILY_LIMIT, getTodayCount } from "./quota";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Accepts both plain "YYYY-MM-DD" and JSON-serialized Date strings
// ("YYYY-MM-DDTHH:mm:ss.sssZ") and keeps only the date part so the
// DATE column never receives a timezone-shifted datetime.
function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const body = req.body || {};
  const status = body.status === "success" ? "success" : "error";

  try {
    await ensureEligibilityCheckTable();

    const todayCount = await getTodayCount();
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: `ครบโควต้าการตรวจสอบสิทธิ ${DAILY_LIMIT} ครั้งต่อวันแล้ว`, todayCount });
    }

    await query(
      `INSERT INTO eligibility_check
        (vn, hn, cid, patient_name, visit_date, status, claim_type, claim_code, result_hcode, claim_date_time, check_date, error_message, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        str(body.vn),
        str(body.hn),
        str(body.cid),
        str(body.patientName),
        dateOnly(body.visitDate),
        status,
        str(body.claimType),
        str(body.claimCode),
        str(body.resultHcode),
        str(body.claimDateTime),
        str(body.checkDate),
        typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 2000) : null,
        session.loginname,
      ]
    );

    return res.status(200).json({ message: "บันทึกผลตรวจสอบสำเร็จ", todayCount: todayCount + 1 });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถบันทึกผลตรวจสอบได้" });
  }
}
