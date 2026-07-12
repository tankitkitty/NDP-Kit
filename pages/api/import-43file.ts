import { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import AdmZip from "adm-zip";
import { getSession } from "../../lib/session";
import { SCHEMA43_TABLES, query43 } from "../../lib/db43";
import { decodeBuffer, parseDelimited, getTableColumns, buildUpsertBatches } from "../../lib/import43";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw new Error("ไฟล์มีขนาดใหญ่เกินไป (จำกัดไม่เกิน 150MB)");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

interface FileResult {
  file: string;
  table: string;
  rowsParsed: number;
  rowsImported: number;
  malformedRows: number;
  errors: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  let buffer: Buffer;
  try {
    buffer = await readRawBody(req);
  } catch (error: any) {
    return res.status(413).json({ error: error?.message || "ไม่สามารถอ่านไฟล์ที่อัพโหลดได้" });
  }

  if (buffer.length === 0) {
    return res.status(400).json({ error: "ไม่พบไฟล์ที่อัพโหลด" });
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return res.status(400).json({ error: "ไฟล์ที่อัพโหลดไม่ใช่ไฟล์ ZIP ที่ถูกต้อง" });
  }

  const tableSet = new Set(SCHEMA43_TABLES);
  const skippedFiles: string[] = [];
  const results: FileResult[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const baseName = path.basename(entry.entryName);
    const table = baseName.replace(/\.[^.]+$/, "").toLowerCase();

    if (!tableSet.has(table)) {
      skippedFiles.push(baseName);
      continue;
    }

    const result: FileResult = {
      file: baseName,
      table,
      rowsParsed: 0,
      rowsImported: 0,
      malformedRows: 0,
      errors: [],
    };
    results.push(result);

    try {
      const text = decodeBuffer(entry.getData());
      const { header, rows } = parseDelimited(text);
      result.rowsParsed = rows.length;

      if (rows.length === 0) {
        continue;
      }

      const columns = await getTableColumns(table);
      const { batches, usedColumns, malformedRows } = buildUpsertBatches(table, header, rows, columns);
      result.malformedRows = malformedRows;

      if (usedColumns.length === 0) {
        result.errors.push("ไม่พบคอลัมน์ในไฟล์ที่ตรงกับตารางในฐานข้อมูล");
        continue;
      }

      for (const batch of batches) {
        try {
          await query43(batch.sql, batch.values);
          result.rowsImported += batch.values[0].length;
        } catch (batchError: any) {
          result.errors.push(batchError?.message || "เกิดข้อผิดพลาดขณะบันทึกข้อมูล");
        }
      }
    } catch (fileError: any) {
      result.errors.push(fileError?.message || "ไม่สามารถประมวลผลไฟล์นี้ได้");
    }
  }

  const totalImported = results.reduce((sum, r) => sum + r.rowsImported, 0);
  const filesWithErrors = results.filter((r) => r.errors.length > 0).length;

  const message =
    `นำเข้าข้อมูลสำเร็จ ${totalImported.toLocaleString()} แถว จาก ${results.length} ไฟล์` +
    (skippedFiles.length > 0 ? ` — ข้ามไฟล์ที่ไม่รู้จัก ${skippedFiles.length} ไฟล์` : "") +
    (filesWithErrors > 0 ? ` — มีข้อผิดพลาดใน ${filesWithErrors} ไฟล์` : "");

  return res.status(200).json({ message, results, skippedFiles });
}
