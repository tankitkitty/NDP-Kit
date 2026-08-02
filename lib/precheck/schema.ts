import { selectOnly } from "./readonly";

/**
 * ตัวช่วยสำรวจโครงสร้างตารางจาก information_schema
 * เพราะ HOSxP แต่ละรุ่น/แต่ละหน่วยบริการมีคอลัมน์ไม่เท่ากัน
 * ใช้เลือกเฉพาะคอลัมน์ที่มีจริงมาประกอบ query แทนการเดาแล้วพัง
 */

const cache = new Map<string, Set<string>>();

export async function tableColumns(table: string): Promise<Set<string>> {
  const cached = cache.get(table);
  if (cached) return cached;
  const rows: any = await selectOnly(
    `SELECT LOWER(column_name) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const cols = new Set<string>(rows.map((r: any) => String(r.c)));
  cache.set(table, cols);
  return cols;
}

export async function tableExists(table: string): Promise<boolean> {
  return (await tableColumns(table)).size > 0;
}

/** เลือกชื่อคอลัมน์ตัวแรกใน candidates ที่มีอยู่จริงในตาราง (คืน null ถ้าไม่มีเลย) */
export function pickCol(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (cols.has(c.toLowerCase())) return c;
  }
  return null;
}
