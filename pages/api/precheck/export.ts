import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { buildXlsx, XlsxColumn } from "../../../lib/xlsx";

/** กันไฟล์ใหญ่จนเครื่องหน่วยบริการทำไม่ไหว (ตารางบนหน้าจอจำกัดที่ 1000 แถวอยู่แล้ว) */
const MAX_ROWS = 20000;
const MAX_COLS = 50;
const MAX_CELL_LEN = 2000;

/**
 * ส่งออกตารางที่แสดงอยู่บนหน้าจอเป็นไฟล์ .xlsx
 *
 * รับข้อมูลที่ฝั่งหน้าเว็บถืออยู่แล้วส่งกลับมา ไม่ได้ไปอ่านฐานซ้ำ เพราะสิ่งที่ผู้ใช้
 * ต้องการคือ "รายการที่เห็นอยู่ตรงหน้า" ซึ่งผ่านการกรองด้วยแท็บย่อย (ผ่าน/ไม่ผ่าน)
 * มาแล้ว ถ้าไปดึงใหม่ฝั่งเซิร์ฟเวอร์จะได้คนละชุดกับที่เห็น
 *
 * ปลายทางนี้ไม่แตะฐานข้อมูลเลย เป็นแค่ตัวแปลงข้อมูลเป็นไฟล์
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const body = req.body || {};
  const rawColumns = Array.isArray(body.columns) ? body.columns : [];
  const rawRows = Array.isArray(body.rows) ? body.rows : [];

  const columns: XlsxColumn[] = rawColumns
    .filter((c: any) => c && typeof c.key === "string" && typeof c.label === "string")
    .slice(0, MAX_COLS)
    .map((c: any) => ({ key: c.key, label: c.label }));

  if (columns.length === 0) {
    return res.status(400).json({ error: "ไม่มีคอลัมน์ให้ส่งออก" });
  }
  if (rawRows.length > MAX_ROWS) {
    return res.status(400).json({ error: `ส่งออกได้ไม่เกิน ${MAX_ROWS.toLocaleString()} แถว` });
  }

  // เก็บเฉพาะคีย์ที่เป็นคอลัมน์จริง คีย์พิเศษอย่าง _alert/_warn ไม่ต้องติดไปในไฟล์
  const rows = rawRows.map((row: any) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const value = row && typeof row === "object" ? row[col.key] : "";
      out[col.key] =
        typeof value === "number" ? value : String(value ?? "").slice(0, MAX_CELL_LEN);
    }
    return out;
  });

  try {
    const buffer = buildXlsx(columns, rows);
    // ชื่อไฟล์เป็นภาษาไทยได้ ต้องส่งทั้ง filename แบบ ASCII และ filename* แบบ UTF-8
    // ไม่งั้นเบราว์เซอร์บางตัวจะได้ชื่อเป็นตัวยึกยือ
    const name = sanitizeName(typeof body.filename === "string" ? body.filename : "ผลตรวจ");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`
    );
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "สร้างไฟล์ไม่สำเร็จ" });
  }
}

/** ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้บน Windows ออก */
function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "ผลตรวจ"
  );
}
