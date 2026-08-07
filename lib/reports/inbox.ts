import fs from "fs";
import path from "path";
import { downloadUrlForFileId, listFolderFiles } from "../driveRelease";
import { assertSafeSelect } from "./guard";
import { sanitizeReport } from "./store";
import { ReportParam } from "./types";

/**
 * คำขอสร้างรายงานที่ผู้ช่วยส่งเข้ามา เก็บเป็นไฟล์ JSON ในโฟลเดอร์ย่อยบน Drive
 *
 * ฝั่งนี้อ่านอย่างเดียว ไม่ต้องมี credential — โฟลเดอร์เปิดให้อ่านสาธารณะอยู่แล้ว
 * ส่วนการเขียนไฟล์เข้าไปทำผ่าน Apps Script (ดู docs/apps-script-report-inbox.gs)
 */

/** โฟลเดอร์ย่อย "Report NDP-Kit" ที่ Apps Script เขียนไฟล์คำขอลงไป */
const INBOX_FOLDER_ID = "1Pzv82qI4dlwtn9Gd6Jn7ygRHgsIlUI7p";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 20000;

export interface InboxRequest {
  fileId: string;
  fileName: string;
  kind: "new" | "revision";
  targetId: string;
  sender: string;
  hospital: string;
  note: string;
  submittedAt: string;
  name: string;
  group: string;
  description: string;
  sql: string;
  params: ReportParam[];
  /** ปัญหาที่เจอตอนตรวจ ถ้าไม่ว่างแปลว่ายังสร้างเป็นรายงานไม่ได้ */
  problems: string[];
}

/** รายชื่อไฟล์คำขอ เรียงใหม่ก่อน (ชื่อไฟล์ขึ้นต้นด้วยวันเวลาจาก Apps Script) */
export async function listInbox(): Promise<{ fileId: string; fileName: string }[]> {
  const files = await listFolderFiles(INBOX_FOLDER_ID);
  return files
    .filter((f) => /\.json$/i.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((f) => ({ fileId: f.id, fileName: f.name }));
}

/**
 * โหลดคำขอหนึ่งใบมาพร้อมผลตรวจ
 *
 * ตรวจตั้งแต่ตอนอ่าน ไม่ใช่ตอนกดสร้าง เพื่อให้เห็นตั้งแต่ในรายการว่าใบไหนมีปัญหา
 * ไฟล์จากผู้ช่วยคือข้อมูลที่ไว้ใจไม่ได้เท่ากับที่ผู้ใช้พิมพ์เอง จึงผ่านด่านเดียวกัน
 */
export async function loadRequest(fileId: string, fileName: string): Promise<InboxRequest> {
  const res = await fetch(downloadUrlForFileId(fileId), {
    headers: { "User-Agent": "ndp-kit-inbox", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ ปลายทางตอบกลับรหัส ${res.status}`);

  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("ไฟล์คำขอใหญ่ผิดปกติ");

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("ไฟล์นี้ไม่ใช่ JSON อาจถูกระบบกรองเว็บของหน่วยงานขวางไว้");
  }

  const raw = body?.report ?? {};
  const problems: string[] = [];

  let clean: any = null;
  try {
    clean = sanitizeReport(raw, String(body?.sender ?? ""));
  } catch (error: any) {
    problems.push(error?.message || "รูปแบบรายงานไม่ถูกต้อง");
  }

  const sql = String(raw?.sql ?? "");
  if (clean) {
    try {
      assertSafeSelect(sql);
    } catch (error: any) {
      problems.push(error?.message || "คำสั่ง SQL ไม่ปลอดภัย");
    }
    for (const p of checkParams(sql, clean.params)) problems.push(p);
    for (const p of checkThaiAliases(sql)) problems.push(p);
  }

  return {
    fileId,
    fileName,
    kind: body?.kind === "revision" ? "revision" : "new",
    targetId: String(body?.targetId ?? ""),
    sender: String(body?.sender ?? ""),
    hospital: String(body?.hospital ?? ""),
    note: String(body?.note ?? ""),
    submittedAt: String(body?.submittedAt ?? ""),
    name: String(clean?.name ?? raw?.name ?? "(ไม่มีชื่อ)"),
    group: String(clean?.group ?? raw?.group ?? ""),
    description: String(clean?.description ?? raw?.description ?? ""),
    sql,
    params: clean?.params ?? [],
    problems,
  };
}

/**
 * พารามิเตอร์ต้องตรงกันสองทาง
 *
 * ที่ประกาศไว้แต่ไม่ได้ใช้ = ผู้ใช้กรอกทิ้งเปล่า ส่วนที่ใช้ใน SQL แต่ไม่ได้ประกาศ
 * = รันแล้วพังตอนผู้ใช้กด ซึ่งเป็นตอนที่แก้ไม่ทันแล้ว
 */
function checkParams(sql: string, params: ReportParam[]): string[] {
  const problems: string[] = [];
  for (const p of params) {
    if (!sql.includes(`:${p.name}`)) {
      problems.push(`ประกาศพารามิเตอร์ :${p.name} ไว้แต่ไม่ได้ใช้ใน SQL`);
    }
  }
  const used = new Set([...sql.matchAll(/:([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]));
  for (const u of used) {
    if (!params.some((p) => p.name === u)) {
      problems.push(`ใช้ :${u} ใน SQL แต่ไม่ได้ประกาศเป็นพารามิเตอร์`);
    }
  }
  return problems;
}

/**
 * ชื่อคอลัมน์ภาษาไทยต้องอยู่ใน backtick
 *
 * MariaDB ที่หน่วยบริการใช้ฟ้อง syntax error ทันทีถ้าไม่ครอบ ตรวจตรงนี้เพราะ
 * เป็นสิ่งที่ผู้ช่วยพลาดง่ายที่สุด และพลาดแล้วรายงานใช้ไม่ได้เลยทั้งใบ
 */
function checkThaiAliases(sql: string): string[] {
  // มองหา  AS ตามด้วยอักษรไทยที่ไม่มี backtick นำหน้า
  const bad = [...sql.matchAll(/\bAS\s+([฀-๿][^\s,]*)/gi)].map((m) => m[1]);
  if (bad.length === 0) return [];
  return [`ชื่อคอลัมน์ภาษาไทยต้องอยู่ใน backtick เช่น AS \`${bad[0]}\``];
}

/**
 * สร้างไฟล์รายงานติดโปรแกรมจากคำขอ แล้วต่อทะเบียนใน index.ts ให้เอง
 *
 * เขียนไฟล์ซอร์สโค้ดจริง จึงทำได้เฉพาะเครื่องที่รันจากซอร์ส (เครื่องผู้พัฒนา)
 * เครื่องหน่วยบริการรันจากแพ็กเกจที่ build แล้ว ไม่มีโฟลเดอร์นี้ให้เขียน
 */
export function builtinDir(): string {
  return path.join(process.cwd(), "lib", "reports", "builtin");
}

export function canCreateBuiltin(): boolean {
  try {
    return fs.existsSync(path.join(builtinDir(), "index.ts"));
  } catch {
    return false;
  }
}

/** ชื่อไฟล์/ตัวแปรจากชื่อรายงาน — ต้องเป็น ascii เพราะเป็นชื่อ identifier ใน TS */
function slugFrom(name: string, fallback: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || fallback;
}

function camel(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function createBuiltinFromRequest(
  req: InboxRequest,
  group: string
): { file: string; id: string } {
  if (req.problems.length > 0) {
    throw new Error("คำขอนี้ยังมีปัญหาที่ต้องแก้ก่อน จึงสร้างเป็นรายงานไม่ได้");
  }
  if (!canCreateBuiltin()) {
    throw new Error("เครื่องนี้ไม่ได้รันจากซอร์สโค้ด จึงสร้างไฟล์รายงานไม่ได้");
  }

  const dir = builtinDir();
  const stamp = String(Date.now()).slice(-6);
  let slug = slugFrom(req.name, `report-${stamp}`);
  // ชื่อไฟล์ซ้ำแปลว่าเคยสร้างรายงานชื่อคล้ายกันไปแล้ว เติมเลขต่อท้ายแทนการเขียนทับ
  while (fs.existsSync(path.join(dir, `${camel(slug)}.ts`))) {
    slug = `${slug}-${stamp}`;
  }
  const varName = camel(slug);
  const fileName = `${varName}.ts`;

  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  /**
   * ทำข้อความจากภายนอกให้วางในคอมเมนต์ได้อย่างปลอดภัย
   *
   * ถ้าไม่ทำ ชื่อรายงานที่มี ตัวปิดคอมเมนต์ จะหลุดออกจากคอมเมนต์แล้วกลายเป็นโค้ด
   * ในไฟล์ที่ถูก build แจกไปทุกหน่วยบริการ — ทดสอบแล้วว่าทำได้จริงก่อนแก้
   * ตัดขึ้นบรรทัดใหม่ด้วย ไม่งั้นข้อความหลายบรรทัดจะทะลุออกนอกโครงคอมเมนต์เหมือนกัน
   */
  const commentSafe = (s: string) =>
    String(s || "")
      // ตัวปิดคอมเมนต์ต้องไม่เหลือติดกัน คั่นด้วยช่องว่างไว้
      .replace(/\*\//g, "* /")
      // ขึ้นบรรทัดใหม่ทะลุออกนอกโครงคอมเมนต์ได้เหมือนกัน
      .replace(/[\r\n]+/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 200);

  const params = req.params
    .map(
      (p) =>
        `    { name: ${JSON.stringify(p.name)}, label: ${JSON.stringify(p.label)}, ` +
        `type: ${JSON.stringify(p.type)}, defaultValue: ${JSON.stringify(p.defaultValue ?? "")} },`
    )
    .join("\n");

  const content = `import { BuiltinReport } from "./types";

/**
 * ${commentSafe(req.name)}
 *
 * สร้างจากคำขอของ ${commentSafe(req.sender) || "ผู้ช่วย"}${
   req.hospital ? ` (${commentSafe(req.hospital)})` : ""
 }
 * ส่งเข้ามาเมื่อ ${commentSafe(req.submittedAt) || "-"}${
   req.note ? `\n * หมายเหตุจากผู้ส่ง: ${commentSafe(req.note)}` : ""
 }
 */
const report: BuiltinReport = {
  id: ${JSON.stringify(slug)},
  name: ${JSON.stringify(req.name)},
  group: ${JSON.stringify(group || req.group)},
  description: ${JSON.stringify(req.description)},
  sql: \`${esc(req.sql)}\`,
  params: [
${params}
  ],
};

export default report;
`;

  fs.writeFileSync(path.join(dir, fileName), content, "utf-8");
  registerInIndex(dir, varName, slug);
  return { file: fileName, id: slug };
}

/**
 * เติม import และต่อท้ายทะเบียนใน index.ts
 *
 * แก้ด้วยการแทนที่ข้อความตรงๆ ไม่ได้แปลงเป็น AST เพราะไฟล์นี้เราคุมรูปแบบเองทั้งหมด
 * ถ้าวันหนึ่งรูปแบบเปลี่ยนจนหาจุดต่อไม่เจอ จะโยน error ให้ไปเติมมือแทนการเดา
 */
function registerInIndex(dir: string, varName: string, slug: string): void {
  const indexPath = path.join(dir, "index.ts");
  let src = fs.readFileSync(indexPath, "utf-8");

  const importLine = `import ${varName} from "./${varName}";`;
  if (!src.includes(importLine)) {
    const lastImport = src.lastIndexOf("import ");
    const endOfLine = src.indexOf("\n", lastImport);
    if (lastImport < 0 || endOfLine < 0) {
      throw new Error(`เติม import ใน index.ts ไม่ได้ ให้เพิ่มเองว่า ${importLine}`);
    }
    src = `${src.slice(0, endOfLine + 1)}${importLine}\n${src.slice(endOfLine + 1)}`;
  }

  const marker = /const SOURCES: BuiltinReport\[\] = \[([\s\S]*?)\];/;
  const m = marker.exec(src);
  if (!m) {
    throw new Error(`เติมทะเบียนใน index.ts ไม่ได้ ให้เพิ่ม ${varName} เองในรายการ SOURCES`);
  }
  const inner = m[1].trim();
  const next = inner ? `${inner.replace(/,$/, "")}, ${varName}` : varName;
  src = src.replace(marker, `const SOURCES: BuiltinReport[] = [${next}];`);

  fs.writeFileSync(indexPath, src, "utf-8");
  void slug;
}
