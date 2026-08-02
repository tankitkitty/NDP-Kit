import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { getCheck } from "../../../lib/precheck";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * รันการ์ดตรวจสอบทีละใบ: GET /api/precheck/run?check=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * ทุก query ข้างในเป็น SELECT ผ่านตัวกรอง selectOnly เท่านั้น (read-only)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  const id = typeof req.query.check === "string" ? req.query.check : "";
  const check = getCheck(id);
  if (!check) {
    return res.status(400).json({ error: "ไม่รู้จักหัวข้อตรวจสอบนี้" });
  }

  const from = typeof req.query.from === "string" && DATE_PATTERN.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && DATE_PATTERN.test(req.query.to) ? req.query.to : null;
  if (check.needsRange && (!from || !to)) {
    return res.status(400).json({ error: "หัวข้อนี้ต้องระบุช่วงวันที่ (from/to)" });
  }

  try {
    const outcome = await check.run({ from: from || "", to: to || "" });
    return res.status(200).json(outcome);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ตรวจสอบไม่สำเร็จ" });
  }
}
