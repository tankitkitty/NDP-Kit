import { getPooledConnection } from "../db";
import {
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
  UnsafeSqlError,
  assertSafeSelect,
  bindParams,
  withRowLimit,
} from "./guard";
import { ReportParam } from "./types";

export interface ReportRunResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  /** true = ผลลัพธ์ถูกตัดเพราะเกินจำนวนแถวสูงสุด */
  truncated: boolean;
  elapsedMs: number;
}

/**
 * รันรายงานที่ผู้ใช้เขียน แล้วคืนผลในรูปแบบที่ตารางบนหน้าเว็บใช้ได้เลย
 *
 * ลำดับการป้องกัน:
 *   1. assertSafeSelect  — ปฏิเสธคำสั่งที่ไม่ใช่ SELECT หรือมีฟังก์ชันอันตราย
 *   2. bindParams        — ค่าที่ผู้ใช้กรอกผูกเป็น placeholder ไม่ต่อเป็นข้อความ
 *   3. withRowLimit      — เติม LIMIT ให้ถ้าไม่ได้ใส่มา
 *   4. KILL QUERY        — ตัดทิ้งเมื่อรันนานเกินกำหนด ไม่ให้ฐาน HOSxP อืดทั้งหน่วยงาน
 *   5. ตัดแถวซ้ำอีกชั้น   — เผื่อผู้ใช้ใส่ LIMIT เองเป็นค่ามหาศาล
 */
export async function runReportSql(
  sql: string,
  params: ReportParam[],
  values: Record<string, string>
): Promise<ReportRunResult> {
  assertSafeSelect(sql);
  const bound = bindParams(sql, params, values);
  const finalSql = withRowLimit(bound.sql);

  const started = Date.now();
  const conn = await getPooledConnection();
  // threadId ต้องอ่านไว้ก่อนเริ่มรัน เพราะตอนหมดเวลาคอนเนกชันนี้กำลังติดอยู่กับ
  // query จนคุยด้วยไม่ได้ ต้องใช้อีกคอนเนกชันหนึ่งไปสั่ง KILL แทน
  const threadId = (conn as any).threadId as number | undefined;

  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  try {
    const queryPromise = conn.query(finalSql, bound.values);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        killQuery(threadId).finally(() =>
          reject(
            new UnsafeSqlError(
              `รายงานใช้เวลานานเกิน ${Math.round(QUERY_TIMEOUT_MS / 1000)} วินาที ระบบจึงหยุดให้ — ` +
                `ลองจำกัดช่วงวันที่ให้แคบลง หรือเพิ่ม LIMIT ในคำสั่ง`
            )
          )
        );
      }, QUERY_TIMEOUT_MS);
    });

    const [rawRows]: any = await Promise.race([queryPromise, timeoutPromise]);
    const all = Array.isArray(rawRows) ? rawRows : [];
    const truncated = all.length > MAX_ROWS;
    const rows = truncated ? all.slice(0, MAX_ROWS) : all;

    return {
      columns: deriveColumns(rows),
      rows: rows.map(normalizeRow),
      truncated,
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
    // คอนเนกชันที่เพิ่งโดน KILL ยังใช้ต่อไม่ได้ ทิ้งไปเลยแทนที่จะคืนเข้า pool
    if (timedOut) {
      (conn as any).destroy?.();
    } else {
      conn.release();
    }
  }
}

/** สั่งหยุด query ที่ค้างอยู่ผ่านคอนเนกชันใหม่ (คอนเนกชันเดิมคุยด้วยไม่ได้แล้ว) */
async function killQuery(threadId: number | undefined): Promise<void> {
  if (!threadId) return;
  try {
    const killer = await getPooledConnection();
    try {
      // KILL QUERY หยุดเฉพาะคำสั่งที่รันอยู่ ไม่ตัดคอนเนกชันทิ้งทั้งเส้น
      await killer.query(`KILL QUERY ${Number(threadId)}`);
    } finally {
      killer.release();
    }
  } catch {
    // หยุดไม่สำเร็จก็ยังต้องแจ้งผู้ใช้ว่าหมดเวลา ไม่ให้ค้างรอต่อ
  }
}

/**
 * สร้างรายการคอลัมน์จากคีย์ของแถวแรก
 *
 * ใช้ชื่อคอลัมน์ที่ฐานข้อมูลคืนมาเป็นทั้ง key และป้ายบนหัวตาราง เพราะผู้เขียนรายงาน
 * ตั้งชื่อเองได้อยู่แล้วด้วย AS ในคำสั่ง ซึ่งอ่านง่ายกว่าให้ระบบเดาชื่อไทยให้
 */
function deriveColumns(rows: any[]): { key: string; label: string }[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => ({ key, label: key }));
}

/**
 * แปลงค่าที่ driver คืนมาให้เป็นข้อความที่แสดงผลได้
 *
 * ต้องแปลง Date เองเป็น YYYY-MM-DD ไม่งั้นจะกลายเป็น "Fri Aug 30 2025..." บนหน้าจอ
 * ส่วน Buffer (คอลัมน์ BLOB) แปลงเป็นข้อความตรงๆ ไม่ได้ จึงบอกขนาดแทน
 */
function normalizeRow(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value === null || value === undefined) {
      out[key] = "";
    } else if (value instanceof Date) {
      out[key] = formatDate(value);
    } else if (Buffer.isBuffer(value)) {
      out[key] = `(ข้อมูลไบนารี ${value.length} ไบต์)`;
    } else if (typeof value === "object") {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
  return hasTime ? `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : ymd;
}
