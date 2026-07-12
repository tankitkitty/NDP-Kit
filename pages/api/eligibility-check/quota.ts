import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { query, ensureEligibilityCheckTable } from "../../../lib/db";

export const DAILY_LIMIT = 3000;

export async function getTodayCount(): Promise<number> {
  const rows: any = await query(
    "SELECT COUNT(*) as c FROM eligibility_check WHERE checked_at >= CURDATE() AND checked_at < CURDATE() + INTERVAL 1 DAY"
  );
  return Number(rows[0]?.c || 0);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    await ensureEligibilityCheckTable();
    const todayCount = await getTodayCount();
    return res.status(200).json({
      todayCount,
      dailyLimit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - todayCount),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถตรวจสอบโควต้าได้" });
  }
}
