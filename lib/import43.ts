import iconv from "iconv-lite";
import { query43 } from "./db43";

export interface ParsedFile {
  header: string[];
  rows: string[][];
}

export interface ColumnInfo {
  nullable: boolean;
}

export function decodeBuffer(buf: Buffer): string {
  const asUtf8 = buf.toString("utf8");
  if (Buffer.from(asUtf8, "utf8").equals(buf)) {
    return stripBom(asUtf8);
  }
  return stripBom(iconv.decode(buf, "windows874"));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseDelimited(text: string): ParsedFile {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = lines[0].split("|").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => line.split("|"));
  return { header, rows };
}

export async function getTableColumns(table: string): Promise<Map<string, ColumnInfo>> {
  const rows = (await query43(
    `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )) as any[];

  const map = new Map<string, ColumnInfo>();
  for (const row of rows) {
    map.set(String(row.name).toLowerCase(), { nullable: row.nullable === "YES" });
  }
  return map;
}

export interface UpsertBatch {
  sql: string;
  values: any[];
}

export function buildUpsertBatches(
  table: string,
  header: string[],
  rows: string[][],
  columns: Map<string, ColumnInfo>,
  batchSize = 500
): { batches: UpsertBatch[]; usedColumns: string[]; malformedRows: number } {
  const columnIndexes: { name: string; index: number }[] = [];
  header.forEach((name, index) => {
    // first occurrence wins — a duplicated header column would otherwise
    // produce "Column specified twice" and fail every batch
    if (columns.has(name) && !columnIndexes.some((c) => c.name === name)) {
      columnIndexes.push({ name, index });
    }
  });

  if (columnIndexes.length === 0) {
    return { batches: [], usedColumns: [], malformedRows: 0 };
  }

  let malformedRows = 0;
  const values: any[][] = [];
  for (const row of rows) {
    // ข้ามแถวที่จำนวนคอลัมน์ไม่ตรงกับ header — ถ้า upsert ต่อจะเขียนทับ
    // ข้อมูลเดิมที่ถูกต้องด้วยค่าว่างผ่าน ON DUPLICATE KEY UPDATE
    if (row.length !== header.length) {
      malformedRows += 1;
      continue;
    }
    values.push(
      columnIndexes.map(({ name, index }) => {
        const raw = row[index].replace(/\r$/, "");
        if (raw === "" && columns.get(name)?.nullable) return null;
        return raw;
      })
    );
  }

  const usedColumns = columnIndexes.map((c) => c.name);
  const columnList = usedColumns.map((c) => `\`${c}\``).join(",");
  const updateList = usedColumns.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(",");
  const sql = `INSERT INTO \`${table}\` (${columnList}) VALUES ? ON DUPLICATE KEY UPDATE ${updateList}`;

  const batches: UpsertBatch[] = [];
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    batches.push({ sql, values: [chunk] });
  }

  return { batches, usedColumns, malformedRows };
}
