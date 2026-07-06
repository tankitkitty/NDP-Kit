import { NextApiRequest, NextApiResponse } from "next";
import { query } from "../../lib/db";
import { getSession } from "../../lib/session";

const PAGE_SIZE = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const REAL_COLUMNS = [
  "eclaim_fee_schedule_id",
  "vn",
  "hn",
  "eclaim_fee_schedule_req_date",
  "eclaim_fee_schedule_req",
  "eclaim_fee_schedule_resp",
  "eclaim_fee_schedule_status",
  "claim_staff",
  "last_update",
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
];

const SORTABLE_COLUMNS = new Set([...REAL_COLUMNS, "patient_name"]);

function statusFilter(status: string): string {
  if (status === "N") return "e.eclaim_fee_schedule_status = 'N'";
  if (status === "Y") return "e.eclaim_fee_schedule_status = 'Y'";
  if (status === "C") return "e.eclaim_fee_schedule_status = 'C'";
  if (status === "null") return "e.eclaim_fee_schedule_status IS NULL";
  return "1=1";
}

function parseDateParam(value: unknown): string | null {
  const str = typeof value === "string" ? value : "";
  return DATE_PATTERN.test(str) ? str : null;
}

function parseFilters(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return {};
    const result: Record<string, string> = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (SORTABLE_COLUMNS.has(key) && typeof value === "string" && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  const status = ["N", "Y", "C", "null", "all"].includes(String(req.query.status))
    ? String(req.query.status)
    : "all";
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const filters = parseFilters(req.query.filters);

  const sortKeyRaw = typeof req.query.sort === "string" ? req.query.sort : "vn";
  const sortKey = SORTABLE_COLUMNS.has(sortKeyRaw) ? sortKeyRaw : "vn";
  const sortDir = req.query.dir === "asc" ? "ASC" : "DESC";

  const innerConditions: string[] = [];
  const innerParams: any[] = [];
  if (from) {
    innerConditions.push("e.eclaim_fee_schedule_req_date >= ?");
    innerParams.push(`${from} 00:00:00`);
  }
  if (to) {
    innerConditions.push("e.eclaim_fee_schedule_req_date < DATE_ADD(?, INTERVAL 1 DAY)");
    innerParams.push(to);
  }

  let patientNameFilter: string | null = null;
  for (const [key, value] of Object.entries(filters)) {
    if (key === "patient_name") {
      patientNameFilter = value;
    } else {
      innerConditions.push(`e.${key} LIKE ?`);
      innerParams.push(`%${value}%`);
    }
  }

  const innerWhereBase = innerConditions.length ? innerConditions.join(" AND ") : "1=1";
  const innerWhereWithStatus = [statusFilter(status), ...innerConditions].join(" AND ");
  const outerWhere = patientNameFilter ? "WHERE patient_name LIKE ?" : "";
  const outerParams = patientNameFilter ? [`%${patientNameFilter}%`] : [];

  const patientNameExpr =
    "TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')))";

  try {
    const counts: any = await query(
      `SELECT
        SUM(CASE WHEN status = 'N' THEN 1 ELSE 0 END) as n_count,
        SUM(CASE WHEN status = 'Y' THEN 1 ELSE 0 END) as y_count,
        SUM(CASE WHEN status = 'C' THEN 1 ELSE 0 END) as c_count,
        SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END) as null_count,
        COUNT(*) as all_count
      FROM (
        SELECT e.eclaim_fee_schedule_status as status, ${patientNameExpr} as patient_name
        FROM eclaim_fee_schedule e
        LEFT JOIN patient p ON p.hn = e.hn
        WHERE ${innerWhereBase}
      ) t
      ${outerWhere}`,
      [...innerParams, ...outerParams]
    );

    const totalRows: any = await query(
      `SELECT COUNT(*) as total FROM (
        SELECT e.eclaim_fee_schedule_id, ${patientNameExpr} as patient_name
        FROM eclaim_fee_schedule e
        LEFT JOIN patient p ON p.hn = e.hn
        WHERE ${innerWhereWithStatus}
      ) t
      ${outerWhere}`,
      [...innerParams, ...outerParams]
    );

    const rows = await query(
      `SELECT * FROM (
        SELECT
          e.*,
          ${patientNameExpr} as patient_name
        FROM eclaim_fee_schedule e
        LEFT JOIN patient p ON p.hn = e.hn
        WHERE ${innerWhereWithStatus}
      ) t
      ${outerWhere}
      ORDER BY ${sortKey} ${sortDir}
      LIMIT ? OFFSET ?`,
      [...innerParams, ...outerParams, PAGE_SIZE, offset]
    );

    return res.status(200).json({
      rows,
      page,
      pageSize: PAGE_SIZE,
      total: totalRows[0]?.total || 0,
      counts: {
        N: counts[0]?.n_count || 0,
        Y: counts[0]?.y_count || 0,
        C: counts[0]?.c_count || 0,
        null: counts[0]?.null_count || 0,
        all: counts[0]?.all_count || 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "ไม่สามารถโหลดข้อมูลได้" });
  }
}
