import fs from "fs";
import path from "path";
import { builtinReports } from "./builtin";
import { ReportDefinition } from "./types";

/**
 * ส่งคำขอสร้างรายงานจากผู้ช่วยไปยังส่วนกลาง
 *
 * ตัวโปรแกรมเขียนไฟล์ลง Google Drive เองไม่ได้ (ต้องมี credential ที่เขียนได้
 * ซึ่งไม่ควรอยู่ในเครื่องผู้ช่วย) จึงส่งผ่าน Apps Script ที่ทำงานด้วยสิทธิ์ของ
 * เจ้าของสคริปต์แทน — ดูวิธีติดตั้งใน docs/apps-script-report-inbox.gs
 */

/**
 * ที่อยู่ส่วนกลาง — ใส่ไว้ในโค้ดเป็นค่าตั้งต้น เครื่องผู้ช่วยจึงไม่ต้องตั้งค่าอะไรเลย
 * แค่เปิดโหมดผู้ดูแลก็กดส่งได้
 *
 * **สองค่านี้ติดไปกับโปรแกรมทุกเครื่อง ไม่ใช่ความลับ** ใครแกะไฟล์โปรแกรมดูก็เห็น
 * รหัสนี้กันแค่คนที่บังเอิญเจอ URL แล้วยิงข้อมูลขยะเข้ามา ความเสียหายสูงสุดถ้าหลุด
 * คือมีไฟล์ขยะในโฟลเดอร์คำขอ ซึ่งลบทิ้งได้ ไม่กระทบข้อมูลผู้ป่วยหรือไฟล์โปรแกรม
 * (ไฟล์คำขอทุกใบยังต้องผ่านด่านตรวจก่อนถูกสร้างเป็นรายงานอยู่ดี)
 *
 * เปลี่ยนภายหลังได้โดยไม่ต้องปล่อยเวอร์ชันใหม่ ด้วยการวางไฟล์
 * data/report-inbox.json ทับ — ห้ามเก็บใน start.cmd เพราะตัวช่วยติดตั้งเขียน
 * ไฟล์นั้นทับใหม่ทุกครั้งที่อัปเดต ค่าที่ตั้งไว้จะหายเงียบๆ ส่วนโฟลเดอร์ data
 * ตัวช่วยติดตั้งยกออกมาพักแล้วคืนกลับให้เสมอ
 */
const DEFAULT_URL =
  "https://script.google.com/macros/s/AKfycbwTEIYvokNvHHjpLv-OdGzmjYsjOBmwWcocN51v4hCmaC41MobyJOMYbvCnyESd3JV1_g/exec";
const DEFAULT_TOKEN = "5369afd8a755c4febd1085d38d202a48482128143f55658b";

const configPath = path.join(process.cwd(), "data", "report-inbox.json");

interface InboxConfig {
  url: string;
  token: string;
}

/** ลำดับความสำคัญ: ตัวแปรระบบ > ไฟล์ใน data > ค่าตั้งต้นในโค้ด */
function readConfig(): InboxConfig {
  let url = process.env.REPORT_INBOX_URL || "";
  let token = process.env.REPORT_INBOX_TOKEN || "";

  if (!url || !token) {
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        url = url || String(parsed?.url ?? "").trim();
        token = token || String(parsed?.token ?? "").trim();
      }
    } catch {
      // ไฟล์เสียก็ถอยไปใช้ค่าตั้งต้นในโค้ด ดีกว่าปุ่มส่งใช้ไม่ได้เฉยๆ
    }
  }

  return { url: url || DEFAULT_URL, token: token || DEFAULT_TOKEN };
}

const TIMEOUT_MS = 20000;

export function isSubmitConfigured(): boolean {
  const c = readConfig();
  return !!c.url && !!c.token;
}

/**
 * เทียบว่ารายงานชื่อนี้มีอยู่ในระบบแล้วหรือยัง
 *
 * เทียบในเครื่องได้เลยไม่ต้องต่อเน็ต เพราะรายงานที่อยู่ในระบบแล้วติดมากับตัว
 * โปรแกรมของผู้ช่วยอยู่แล้ว ตัดช่องว่างและตัวพิมพ์ออกก่อนเทียบ เพราะคนพิมพ์ชื่อ
 * ต่างกันนิดหน่อยแต่หมายถึงรายงานเดียวกัน
 */
export function findExistingBuiltin(name: string): ReportDefinition | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  return builtinReports().find((r) => normalizeName(r.name) === key);
}

function normalizeName(s: string): string {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

export interface SubmitInput {
  report: ReportDefinition;
  /** new = ขอเพิ่มใบใหม่ · revision = ขอแก้ของที่มีอยู่แล้ว */
  kind: "new" | "revision";
  /** id ของรายงานเดิมที่ขอแก้ (เฉพาะ kind = revision) */
  targetId?: string;
  sender: string;
  hospital: string;
  note?: string;
}

export async function submitReport(input: SubmitInput): Promise<{ fileName: string }> {
  const config = readConfig();
  if (!config.url || !config.token) {
    throw new Error("เครื่องนี้ยังไม่ได้ตั้งค่าที่อยู่ส่วนกลาง (data\\report-inbox.json)");
  }

  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Apps Script ตอบ 302 ไปยัง googleusercontent ก่อนเสมอ ต้องตามต่อ
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      token: config.token,
      kind: input.kind,
      targetId: input.targetId || "",
      sender: input.sender,
      hospital: input.hospital,
      note: input.note || "",
      report: {
        name: input.report.name,
        group: input.report.group,
        description: input.report.description,
        sql: input.report.sql,
        params: input.report.params,
      },
    }),
  });

  if (!res.ok) throw new Error(`ส่วนกลางตอบกลับรหัส ${res.status}`);

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    // ถ้า deploy ผิดแบบ (เช่นตั้ง access เป็น "Only myself") Google จะคืนหน้า
    // ล็อกอินเป็น HTML แทน JSON ซึ่งพังตรงนี้พอดี บอกให้ตรงจะได้แก้ถูกจุด
    throw new Error("ส่วนกลางไม่ได้ตอบเป็นข้อมูล อาจตั้งสิทธิ์ตอน deploy ไม่ถูกต้อง");
  }

  if (!data?.ok) throw new Error(data?.error || "ส่วนกลางปฏิเสธคำขอ");
  return { fileName: String(data.fileName || "") };
}
