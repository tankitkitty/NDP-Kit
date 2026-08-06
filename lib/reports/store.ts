import crypto from "crypto";
import fs from "fs";
import path from "path";
import { UnsafeSqlError, assertSafeSelect, assertValidParamName } from "./guard";
import { ReportDefinition, ReportParam, ReportParamType } from "./types";

const storePath = path.join(process.cwd(), "data", "reports.json");

/** กันไฟล์บวมจนโหลดหน้าไม่ไหว และกันคนวางคำสั่งยาวผิดปกติ */
const MAX_REPORTS = 200;
const MAX_SQL_LEN = 20000;
const MAX_NAME_LEN = 120;
const MAX_DESC_LEN = 500;
const MAX_GROUP_LEN = 60;
const MAX_PARAMS = 10;

/**
 * ที่เก็บรายงานที่ผู้ใช้เขียนเอง — ไฟล์ JSON ธรรมดาใน data/
 *
 * ไม่เก็บลงฐาน HOSxP เพราะแอปนี้ต้องไม่เขียนอะไรลงฐานของโรงพยาบาลเลย
 * และไม่เข้ารหัสแบบ dbconfig.json เพราะไฟล์นี้ตั้งใจให้ก๊อปไปให้หน่วยอื่นได้
 * (ข้างในมีแค่คำสั่ง SQL ไม่มีรหัสผ่านและไม่มีข้อมูลผู้ป่วย)
 */
export function loadReports(): ReportDefinition[] {
  try {
    if (!fs.existsSync(storePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReportShape);
  } catch {
    // ไฟล์เสียไม่ควรทำให้ทั้งหน้าเปิดไม่ได้ — ถือว่ายังไม่มีรายงาน
    return [];
  }
}

function saveAll(reports: ReportDefinition[]): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(reports, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function isReportShape(value: any): value is ReportDefinition {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.sql === "string"
  );
}

export function getReport(id: string): ReportDefinition | undefined {
  return loadReports().find((r) => r.id === id);
}

/**
 * ตรวจและทำความสะอาดข้อมูลรายงานที่รับมาจากหน้าเว็บหรือจากไฟล์นำเข้า
 *
 * ทุกทางที่รายงานเข้ามาในระบบต้องผ่านฟังก์ชันนี้ ไม่ว่าจะพิมพ์เองหรือนำเข้าไฟล์
 * เพราะไฟล์ที่รับมาจากหน่วยอื่นคือข้อมูลที่ไว้ใจไม่ได้พอๆ กับที่ผู้ใช้พิมพ์เอง
 */
export function sanitizeReport(input: any, fallbackAuthor: string): Omit<ReportDefinition, "id" | "createdAt" | "updatedAt" | "source"> {
  const name = String(input?.name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!name) throw new UnsafeSqlError("กรุณาตั้งชื่อรายงาน");

  const sql = String(input?.sql ?? "");
  if (sql.length > MAX_SQL_LEN) {
    throw new UnsafeSqlError(`คำสั่ง SQL ยาวเกิน ${MAX_SQL_LEN.toLocaleString()} ตัวอักษร`);
  }
  assertSafeSelect(sql);

  const rawParams = Array.isArray(input?.params) ? input.params : [];
  if (rawParams.length > MAX_PARAMS) {
    throw new UnsafeSqlError(`ใส่พารามิเตอร์ได้ไม่เกิน ${MAX_PARAMS} ตัว`);
  }

  const seen = new Set<string>();
  const params: ReportParam[] = rawParams.map((p: any) => {
    const paramName = String(p?.name ?? "").trim();
    assertValidParamName(paramName);
    if (seen.has(paramName)) {
      throw new UnsafeSqlError(`พารามิเตอร์ชื่อ "${paramName}" ซ้ำกัน`);
    }
    seen.add(paramName);

    const type: ReportParamType =
      p?.type === "date" || p?.type === "number" ? p.type : "text";

    return {
      name: paramName,
      label: String(p?.label ?? paramName).trim().slice(0, 80) || paramName,
      type,
      defaultValue: String(p?.defaultValue ?? "").slice(0, 200),
    };
  });

  return {
    name,
    group: String(input?.group ?? "").trim().slice(0, MAX_GROUP_LEN),
    description: String(input?.description ?? "").trim().slice(0, MAX_DESC_LEN),
    sql,
    params,
    author: String(input?.author ?? fallbackAuthor ?? "").trim().slice(0, 120),
  };
}

/**
 * ชื่อหมวดที่ใช้แสดงเมื่อรายงานไม่ได้ระบุหมวดไว้
 *
 * เก็บในไฟล์เป็นค่าว่างตามที่ผู้ใช้กรอก ไม่ได้เติมคำนี้ลงไป เพราะถ้าเก็บจริง
 * เวลาผู้ใช้ตั้งหมวดชื่อนี้เองจะกลายเป็นคนละหมวดที่ชื่อเหมือนกัน
 */
export const UNGROUPED_LABEL = "ไม่ระบุหมวด";

/** สร้างใหม่หรือแก้ของเดิม — ส่ง id มาด้วยคือแก้ ไม่ส่งคือสร้างใหม่ */
export function upsertReport(
  input: any,
  fallbackAuthor: string,
  source: "local" | "imported" = "local"
): ReportDefinition {
  const clean = sanitizeReport(input, fallbackAuthor);
  const reports = loadReports();
  const now = new Date().toISOString();
  const id = typeof input?.id === "string" && input.id ? input.id : crypto.randomUUID();

  const existingIndex = reports.findIndex((r) => r.id === id);
  if (existingIndex >= 0) {
    const merged: ReportDefinition = {
      ...reports[existingIndex],
      ...clean,
      id,
      // แก้ไขรายงานที่รับมาแล้ว ถือว่าเป็นของหน่วยนี้เอง ไม่ต้องเตือนซ้ำ
      source: "local",
      updatedAt: now,
    };
    reports[existingIndex] = merged;
    saveAll(reports);
    return merged;
  }

  if (reports.length >= MAX_REPORTS) {
    throw new UnsafeSqlError(`เก็บรายงานได้ไม่เกิน ${MAX_REPORTS} รายการ กรุณาลบของเก่าก่อน`);
  }

  const created: ReportDefinition = {
    ...clean,
    id,
    source,
    createdAt: now,
    updatedAt: now,
  };
  reports.push(created);
  saveAll(reports);
  return created;
}

export function deleteReport(id: string): boolean {
  const reports = loadReports();
  const next = reports.filter((r) => r.id !== id);
  if (next.length === reports.length) return false;
  saveAll(next);
  return true;
}

/**
 * นำเข้ารายงานจากไฟล์ที่หน่วยอื่นส่งมา
 *
 * ตั้ง id ใหม่เสมอ ไม่ใช้ id ที่ติดมากับไฟล์ เพื่อไม่ให้ไฟล์ที่รับมาไปเขียนทับ
 * รายงานที่หน่วยนี้เขียนเองซึ่งบังเอิญมี id ตรงกัน (เช่น รับไฟล์ที่เคยส่งออกไป
 * แล้วถูกแก้กลับมา) — ผู้ใช้ควรได้เห็นทั้งสองใบแล้วเลือกเองว่าจะเก็บอันไหน
 */
export function importBundle(
  bundle: any,
  fallbackAuthor: string
): { imported: number; skipped: { name: string; reason: string }[] } {
  const rawReports = Array.isArray(bundle?.reports) ? bundle.reports : null;
  if (!rawReports) {
    throw new UnsafeSqlError("ไฟล์นี้ไม่ใช่ไฟล์รายงานของ NDP-Kit");
  }

  const skipped: { name: string; reason: string }[] = [];
  let imported = 0;

  for (const raw of rawReports) {
    const label = String(raw?.name ?? "(ไม่มีชื่อ)").slice(0, MAX_NAME_LEN);
    try {
      upsertReport({ ...raw, id: undefined }, raw?.author || fallbackAuthor, "imported");
      imported++;
    } catch (error: any) {
      skipped.push({ name: label, reason: error?.message || "รูปแบบไม่ถูกต้อง" });
    }
  }

  return { imported, skipped };
}
