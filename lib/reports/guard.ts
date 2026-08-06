import { ReportParam } from "./types";

/**
 * ด่านตรวจคำสั่ง SQL ที่ผู้ใช้เขียนเอง ก่อนส่งให้ฐานข้อมูล
 *
 * ต่างจาก lib/precheck/readonly.ts ตรงที่ไฟล์นั้นกรอง SQL ที่ "นักพัฒนาเขียน"
 * ซึ่งไว้ใจได้ระดับหนึ่ง ส่วนไฟล์นี้กรอง SQL ที่ "ใครก็ได้ที่ล็อกอินเข้ามาเขียน"
 * และอาจเป็นไฟล์ที่รับต่อมาจากหน่วยงานอื่น จึงต้องเข้มกว่ามาก
 *
 * ข้อจำกัดที่ต้องรู้: การกรองด้วยข้อความไม่มีทางกันได้ 100%
 * ด่านที่แข็งแรงกว่าคือให้แอปต่อฐานด้วย MySQL user ที่มีสิทธิ์ SELECT อย่างเดียว
 * (ดู docs/readonly-user.md) ไฟล์นี้เป็นด่านที่สอง ไม่ใช่ด่านเดียว
 */

export class UnsafeSqlError extends Error {}

/** จำนวนแถวสูงสุดที่ยอมให้ดึงกลับมา — กันหน่วยความจำหมดตอนคนเผลอ SELECT ทั้งตาราง */
export const MAX_ROWS = 5000;

/** เวลาสูงสุดที่ยอมให้ query หนึ่งใช้ (มิลลิวินาที) เกินแล้วสั่ง KILL ทิ้ง */
export const QUERY_TIMEOUT_MS = 30000;

/**
 * คำสั่ง/ฟังก์ชันที่ห้ามใช้ แม้จะขึ้นต้นด้วย SELECT ก็ตาม
 *
 * ทุกตัวในนี้มีเคสจริงที่ทำให้ SELECT ธรรมดากลายเป็นการโจมตีได้ ไม่ได้ห้ามไว้เผื่อ
 */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\binto\s+(outfile|dumpfile)\b/i, why: "เขียนไฟล์ลงเครื่องเซิร์ฟเวอร์" },
  { re: /\bload_file\s*\(/i, why: "อ่านไฟล์จากเครื่องเซิร์ฟเวอร์ (เช่น ไฟล์รหัสผ่าน)" },
  { re: /\bbenchmark\s*\(/i, why: "สั่งฐานข้อมูลทำงานวนซ้ำจนเครื่องช้าทั้งหน่วยงาน" },
  { re: /\bsleep\s*\(/i, why: "หน่วงเวลาให้ฐานข้อมูลค้าง" },
  { re: /\bmaster_pos_wait\s*\(/i, why: "หน่วงเวลาให้ฐานข้อมูลค้าง" },
  { re: /\b(get_lock|release_lock|is_used_lock|release_all_locks)\s*\(/i, why: "จับล็อกค้างไว้ในฐานข้อมูล" },
  { re: /\bname_const\s*\(/i, why: "ฟังก์ชันที่ใช้หลบการตรวจสอบ" },
  { re: /\bfor\s+update\b/i, why: "ล็อกแถวข้อมูลไว้ไม่ให้คนอื่นใช้" },
  { re: /\block\s+in\s+share\s+mode\b/i, why: "ล็อกแถวข้อมูลไว้ไม่ให้คนอื่นใช้" },
  { re: /\bmysql\s*\./i, why: "อ่านตารางระบบ mysql ซึ่งเก็บรหัสผ่านของผู้ใช้ฐานข้อมูล" },
  { re: /\bperformance_schema\s*\./i, why: "อ่านตารางระบบของฐานข้อมูล" },
  { re: /\binto\s+@/i, why: "เก็บผลลงตัวแปรในเซสชัน" },
  { re: /\bset\s+@/i, why: "ตั้งค่าตัวแปรในเซสชัน" },
];

/**
 * ตัด comment ออกเพื่อเอา "เนื้อคำสั่งจริง" มาตรวจ
 *
 * ต้องตัดทั้งสามแบบที่ MySQL รองรับ ไม่งั้นซ่อนคำสั่งไว้ในนั้นแล้วหลุดด่านได้
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .trim();
}

/**
 * ตรวจว่า SQL ที่ผู้ใช้เขียนปลอดภัยพอจะรันไหม โยน UnsafeSqlError ถ้าไม่ผ่าน
 */
export function assertSafeSelect(rawSql: string): void {
  const sql = String(rawSql || "");

  if (!sql.trim()) {
    throw new UnsafeSqlError("ยังไม่ได้เขียนคำสั่ง SQL");
  }
  if (sql.includes("\0")) {
    throw new UnsafeSqlError("คำสั่งมีอักขระที่ใช้ไม่ได้");
  }

  // comment แบบ /*! ... */ ของ MySQL ไม่ใช่ comment จริง — เซิร์ฟเวอร์ "รัน" ข้างในให้
  // ถ้าปล่อยผ่าน คนเขียนจะซ่อนคำสั่งอันตรายไว้ในนั้น แล้วด่านที่ตัด comment ทิ้ง
  // ก่อนตรวจจะมองไม่เห็น แต่ฐานข้อมูลรันจริง จึงต้องปฏิเสธตั้งแต่ยังไม่ตัด comment
  if (/\/\*!/.test(sql)) {
    throw new UnsafeSqlError("ไม่อนุญาตคอมเมนต์แบบ /*! เพราะฐานข้อมูลจะรันคำสั่งข้างในจริง");
  }

  const stripped = stripComments(sql);

  if (!/^select\b/i.test(stripped)) {
    throw new UnsafeSqlError("อนุญาตเฉพาะคำสั่งที่ขึ้นต้นด้วย SELECT เท่านั้น (อ่านอย่างเดียว)");
  }

  // ";" คั่นคำสั่ง = แอบต่อคำสั่งที่สองซึ่งอาจเป็น UPDATE/DELETE ได้
  // ยอมให้มี ";" ปิดท้ายตัวเดียวเพราะคนคุ้นกับการพิมพ์แบบนั้น
  if (stripped.replace(/;\s*$/, "").includes(";")) {
    throw new UnsafeSqlError("ไม่อนุญาตหลายคำสั่งใน query เดียว (ห้ามใช้ ; คั่น)");
  }

  for (const rule of FORBIDDEN) {
    if (rule.re.test(stripped)) {
      throw new UnsafeSqlError(`คำสั่งนี้ใช้ไม่ได้เพราะ${rule.why}`);
    }
  }
}

/** ชื่อพารามิเตอร์ที่ยอมรับ — จำกัดให้แคบเพื่อไม่ให้ปนกับไวยากรณ์ SQL */
const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,29}$/i;

export function assertValidParamName(name: string): void {
  if (!PARAM_NAME_RE.test(name)) {
    throw new UnsafeSqlError(
      `ชื่อพารามิเตอร์ "${name}" ใช้ไม่ได้ — ต้องขึ้นต้นด้วยตัวอักษรภาษาอังกฤษ และมีได้แค่ a-z 0-9 _`
    );
  }
}

/**
 * แปลง :ชื่อ ในคำสั่งให้เป็น ? แล้วคืนลำดับค่าที่ต้องส่งคู่กัน
 *
 * ใช้การผูกค่าแบบ placeholder ของ driver ไม่ใช่การต่อสตริง เพราะค่าที่ผู้ใช้กรอก
 * ในช่องพารามิเตอร์คือทางที่ง่ายที่สุดที่จะแทรกคำสั่งเพิ่ม ถ้าเอาไปต่อเป็นข้อความตรงๆ
 *
 * ต้องเดินอ่านทีละตัวอักษรเพื่อข้ามข้อความในเครื่องหมายคำพูด ไม่งั้นค่าอย่าง
 * 'เวลา 10:30' จะถูกเข้าใจผิดว่าเป็นพารามิเตอร์ชื่อ 30
 */
export function bindParams(
  sql: string,
  params: ReportParam[],
  values: Record<string, string>
): { sql: string; values: unknown[] } {
  const known = new Map(params.map((p) => [p.name, p]));
  const out: string[] = [];
  const bound: unknown[] = [];

  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      out.push(ch);
      // \' หนีอักขระในข้อความ ต้องข้ามตัวถัดไปด้วย ไม่งั้นจะคิดว่าปิดข้อความแล้ว
      if (ch === "\\" && i + 1 < sql.length) {
        out.push(sql[++i]);
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out.push(ch);
      continue;
    }

    // :: ของ PostgreSQL ไม่ใช่พารามิเตอร์ ปล่อยผ่านไปให้ฐานข้อมูลฟ้องเอง
    if (ch === ":" && sql[i + 1] !== ":") {
      const rest = sql.slice(i + 1);
      const m = rest.match(/^[a-z][a-z0-9_]{0,29}/i);
      if (m) {
        const name = m[0];
        const def = known.get(name);
        if (!def) {
          throw new UnsafeSqlError(
            `คำสั่งอ้างพารามิเตอร์ :${name} แต่ยังไม่ได้ประกาศไว้ในรายการพารามิเตอร์`
          );
        }
        bound.push(coerceValue(def, values[name]));
        out.push("?");
        i += name.length;
        continue;
      }
    }

    out.push(ch);
  }

  if (quote) {
    throw new UnsafeSqlError("คำสั่งมีเครื่องหมายคำพูดเปิดค้างไว้");
  }

  return { sql: out.join(""), values: bound };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** แปลงค่าที่ผู้ใช้กรอกให้ตรงชนิด และปฏิเสธค่าที่ผิดรูปแบบตั้งแต่ต้นทาง */
function coerceValue(param: ReportParam, raw: string | undefined): unknown {
  const value = raw === undefined || raw === null ? (param.defaultValue ?? "") : String(raw);

  if (param.type === "date") {
    if (!DATE_RE.test(value)) {
      throw new UnsafeSqlError(`ค่า "${param.label || param.name}" ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`);
    }
    return value;
  }

  if (param.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new UnsafeSqlError(`ค่า "${param.label || param.name}" ต้องเป็นตัวเลข`);
    }
    return n;
  }

  // ข้อความส่งเป็น placeholder อยู่แล้ว จึงไม่ต้อง escape เอง แค่จำกัดความยาว
  return value.slice(0, 200);
}

/**
 * เติม LIMIT ให้ถ้าผู้ใช้ไม่ได้ใส่มา
 *
 * ไม่ห่อคำสั่งเป็น subquery เพราะรายงานที่ join หลายตาราง (เช่น ovst o JOIN patient p)
 * มักมีชื่อคอลัมน์ซ้ำกัน ซึ่งจะทำให้ derived table ฟ้อง Duplicate column name
 * ทั้งที่คำสั่งนั้นถูกต้อง — จึงเลือกเติมท้ายแทน แล้วไปตัดจำนวนแถวซ้ำอีกชั้นตอนอ่านผล
 */
export function withRowLimit(sql: string): string {
  const stripped = stripComments(sql).replace(/;\s*$/, "");
  if (/\blimit\b/i.test(stripped)) return stripped;
  return `${stripped}\nLIMIT ${MAX_ROWS + 1}`;
}
