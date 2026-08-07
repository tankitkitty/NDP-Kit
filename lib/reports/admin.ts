import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * โหมดผู้ดูแล — เปิดให้เขียนรายงานและส่งเข้าส่วนกลางได้
 *
 * ปกติหน่วยบริการไม่ต้องเขียน query เอง ใช้รายงานที่ติดมากับโปรแกรม
 * (ดู lib/reports/builtin/) เครื่องทั่วไปจึงไม่มีเมนูพวกนี้ให้เห็น
 *
 * เปิดได้สองทาง
 *   1. กดที่ชื่อตัวเองมุมล่างซ้ายแล้วกรอกรหัส — สำหรับผู้ช่วยที่ช่วยเขียนรายงาน
 *   2. สร้างไฟล์เปล่าชื่อ admin-mode ในโฟลเดอร์ data — สำหรับเครื่องผู้พัฒนา
 *      ที่ไม่อยากกรอกรหัสใหม่ทุกครั้งที่รีสตาร์ท
 *
 * **ขอบเขตที่แท้จริง**: รหัสนี้ติดไปกับโปรแกรมทุกเครื่อง ใครเปิดไฟล์โปรแกรมดู
 * ก็เห็น จึงเป็นแค่การซ่อนเมนูไม่ให้เจ้าหน้าที่ทั่วไปเผลอกด ไม่ใช่การกันคน
 * ที่ตั้งใจจะเข้า ถ้าต้องการกันจริงต้องคุมที่สิทธิ์ผู้ใช้ของ Windows หรือแยกเครื่อง
 *
 * ที่ยังตรวจฝั่งเซิร์ฟเวอร์ด้วย เพราะการซ่อนแค่ปุ่มบนหน้าเว็บไม่ได้กันคนที่ยิง
 * คำขอเข้ามาตรงๆ ซึ่งเป็นคนละเรื่องกับการเดารหัส
 */

const markerPath = path.join(process.cwd(), "data", "admin-mode");

/** รหัสสำหรับเปิดเมนูลับ */
const ADMIN_PASSWORD = "NDP-Kit";

export const ADMIN_COOKIE_NAME = "ndpkit_admin";
export const ADMIN_MAX_AGE_SECONDS = 60 * 60 * 8;

const secretFilePath = path.join(process.cwd(), "data", ".session-secret");
let cachedSecret: string | null = null;

/** ใช้กุญแจตัวเดียวกับ session ของโปรแกรม ไม่ต้องมีไฟล์ความลับเพิ่มอีกไฟล์ */
function getSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  try {
    if (fs.existsSync(secretFilePath)) {
      const stored = fs.readFileSync(secretFilePath, "utf-8").trim();
      if (stored) {
        cachedSecret = stored;
        return cachedSecret;
      }
    }
  } catch {
    // อ่านไม่ได้ก็ใช้ค่าสุ่มในหน่วยความจำ คุกกี้จะหมดอายุตอนรีสตาร์ท
  }
  cachedSecret = crypto.randomBytes(48).toString("hex");
  return cachedSecret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function checkPassword(input: string): boolean {
  const a = Buffer.from(String(input ?? ""), "utf-8");
  const b = Buffer.from(ADMIN_PASSWORD, "utf-8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAdminCookieValue(): string {
  const expires = Date.now() + ADMIN_MAX_AGE_SECONDS * 1000;
  const payload = `admin.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verifyAdminCookie(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;

  const [tag, expiresStr, signature] = parts;
  if (tag !== "admin") return false;

  const expected = sign(`${tag}.${expiresStr}`);
  if (expected.length !== signature.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;

  const expires = Number(expiresStr);
  return Number.isFinite(expires) && Date.now() <= expires;
}

/** ไฟล์ admin-mode ในโฟลเดอร์ data — ทางลัดของเครื่องผู้พัฒนา */
function hasMarkerFile(): boolean {
  try {
    return fs.existsSync(markerPath);
  } catch {
    return false;
  }
}

export function isAdminMode(req?: { cookies: Partial<Record<string, string>> }): boolean {
  if (hasMarkerFile()) return true;
  if (!req) return false;
  return verifyAdminCookie(req.cookies[ADMIN_COOKIE_NAME]);
}
