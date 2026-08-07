import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { UnsafeSqlError } from "../../../lib/reports/guard";
import { runReportSql } from "../../../lib/reports/run";
import { findReport } from "../../../lib/reports/registry";

/**
 * รันรายงาน: POST { id, values }  หรือ  POST { sql, params, values } (ทดลองรันตอนเขียน)
 *
 * บันทึก log ไว้ทุกครั้งว่าใครรันอะไร เพราะฟีเจอร์นี้เปิดให้เขียนคำสั่งอ่านฐานเองได้
 * ถ้าวันหนึ่งมีข้อมูลรั่ว ต้องไล่ย้อนได้ว่าใครดึงอะไรออกไปเมื่อไหร่
 */
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
  const values = body.values && typeof body.values === "object" ? body.values : {};

  let sql: string;
  let params: any[];
  let label: string;

  if (typeof body.id === "string" && body.id) {
    const report = findReport(body.id);
    if (!report) return res.status(404).json({ error: "ไม่พบรายงานนี้" });
    sql = report.sql;
    params = report.params || [];
    label = report.name;
  } else {
    sql = String(body.sql ?? "");
    params = Array.isArray(body.params) ? body.params : [];
    label = "(ทดลองรัน)";
  }

  try {
    const result = await runReportSql(sql, params, values);
    logReport(`${session.loginname} รัน "${label}" ได้ ${result.rows.length} แถว ใช้เวลา ${result.elapsedMs}ms`);
    return res.status(200).json(result);
  } catch (error: any) {
    // คำสั่งที่ด่านกรองปฏิเสธเป็นความผิดของผู้ใช้ (400) ส่วน error จากฐานเป็น 400 เช่นกัน
    // เพราะเกือบทั้งหมดคือ SQL เขียนผิด ซึ่งผู้ใช้ต้องเห็นข้อความจริงถึงจะแก้ได้
    const message = error?.sqlMessage || error?.message || "รันรายงานไม่สำเร็จ";
    logReport(`${session.loginname} รัน "${label}" ไม่สำเร็จ: ${message}`);
    const status = error instanceof UnsafeSqlError ? 400 : 400;
    return res.status(status).json({ error: message });
  }
}

function logReport(message: string): void {
  console.log(`[report] ${new Date().toISOString()} ${message}`);
}
