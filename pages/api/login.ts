import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { query } from "../../lib/db";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../lib/session";
import { markSetupComplete } from "../../lib/setupToken";

// จำกัดการลองเข้าสู่ระบบต่อ IP เพื่อกันการเดารหัสผ่านแบบ brute force
// เก็บในหน่วยความจำ (เหมาะกับแอปแบบ instance เดียวที่ติดตั้งในหน่วยบริการ)
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstAt: number }>();

/**
 * IP ของผู้เรียก ใช้เป็นกุญแจของตัวนับการล็อกอินผิด
 *
 * ห้ามเชื่อ x-forwarded-for โดยไม่มีเงื่อนไข เพราะโปรแกรมนี้รับ request ตรงจาก
 * เบราว์เซอร์ ไม่ได้อยู่หลัง reverse proxy ใครก็ใส่ header นี้เองมาคนละค่าทุกครั้ง
 * เพื่อให้ตัวนับขึ้นคนละช่อง แล้วเดารหัสผ่านได้ไม่จำกัด (รหัสผ่าน HOSxP เป็น MD5
 * ไม่มี salt ยิ่งต้องกันการเดาให้อยู่)
 *
 * ถ้าติดตั้งไว้หลัง proxy จริง ให้ตั้ง env TRUST_PROXY=1 เพื่อกลับไปอ่าน header
 */
function getClientIp(req: NextApiRequest): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function pruneExpired(now: number) {
  if (failedAttempts.size < 500) return;
  for (const [key, rec] of failedAttempts) {
    if (now - rec.firstAt > WINDOW_MS) failedAttempts.delete(key);
  }
}

function checkRateLimit(ip: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = failedAttempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) return { limited: false, retryAfterSec: 0 };
  if (rec.count >= MAX_FAILED_ATTEMPTS) {
    return { limited: true, retryAfterSec: Math.ceil((WINDOW_MS - (now - rec.firstAt)) / 1000) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function recordFailure(ip: string) {
  const now = Date.now();
  pruneExpired(now);
  const rec = failedAttempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

/**
 * คำขอนี้มาทาง HTTPS จริงหรือไม่
 *
 * ต้องดูจาก "ช่องทางจริง" ไม่ใช่ NODE_ENV แบบเดิม เพราะแพ็กเกจที่หน่วยบริการใช้ถูก
 * ตั้ง NODE_ENV=production เสมอ (Next ตั้งให้ใน server.js ของโหมด standalone)
 * แต่เปิดผ่าน http:// ธรรมดา — cookie ที่ติด Secure บนหน้า http จะถูกเบราว์เซอร์
 * ทิ้งทันที (ยกเว้น localhost) ผลคือเข้าจากเครื่องอื่นในวง LAN แล้วล็อกอิน "สำเร็จ"
 * แต่เด้งกลับหน้าล็อกอินวนไปไม่รู้จบ โดยไม่มีอะไรบอกสาเหตุ
 *
 * ตั้งแบบนี้จึงได้ทั้งสองอย่าง: ใช้ HTTPS เมื่อไหร่ cookie ก็ถูกล็อกด้วย Secure
 * ทันที ส่วนที่ยังเป็น http ก็ยังใช้งานได้ (ป้องกันด้วย HttpOnly + SameSite เท่าเดิม)
 */
function isSecureRequest(req: NextApiRequest): boolean {
  if ((req.socket as any)?.encrypted) return true;
  // อ่าน header ได้เฉพาะตอนบอกไว้ว่าอยู่หลัง proxy จริง ไม่งั้นใครก็ปลอมมาได้
  if (process.env.TRUST_PROXY === "1") {
    const proto = req.headers["x-forwarded-proto"];
    const value = Array.isArray(proto) ? proto[0] : proto;
    if (typeof value === "string" && value.split(",")[0].trim() === "https") return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.limited) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSec));
    const minutes = Math.ceil(rateLimit.retryAfterSec / 60);
    return res
      .status(429)
      .json({ error: `พยายามเข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณาลองใหม่อีกครั้งใน ${minutes} นาที` });
  }

  const loginname = typeof req.body?.loginname === "string" ? req.body.loginname.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!loginname || !password) {
    return res.status(400).json({ error: "กรุณาระบุ Username และ Password" });
  }

  try {
    // HOSxP PCU เก็บผู้ใช้งานในตาราง officer โดย officer_login_password_md5
    // คือ MD5 ของรหัสผ่าน (HOSxP เก็บเป็นตัวพิมพ์ใหญ่) — เทียบแบบไม่สนตัวพิมพ์
    // ด้วย UPPER() ทั้งสองฝั่ง เพื่อให้ตรงกันไม่ว่าฐานจะเก็บเป็นพิมพ์เล็กหรือใหญ่
    const passwordHash = crypto.createHash("md5").update(password).digest("hex").toUpperCase();
    const rows: any = await query(
      `SELECT officer_login_name, officer_active
       FROM officer
       WHERE officer_login_name = ? AND UPPER(officer_login_password_md5) = ? LIMIT 1`,
      [loginname, passwordHash]
    );
    const user = rows[0];

    if (!user || user.officer_active === "N") {
      recordFailure(ip);
      return res.status(401).json({ error: "Username หรือ Password ไม่ถูกต้อง" });
    }

    failedAttempts.delete(ip);

    // เข้าสู่ระบบได้สำเร็จ = ตั้งค่าฐานข้อมูลถูกต้องแล้วจริง และมีเจ้าหน้าที่ตัวจริง
    // เข้ามาดูแลแล้ว จึงปิดช่วงติดตั้งตรงนี้ รหัสติดตั้งครั้งแรกจะใช้ไม่ได้อีก
    markSetupComplete();

    const sessionValue = createSessionValue(user.officer_login_name);
    const secureFlag = isSecureRequest(req) ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`
    );
    return res.status(200).json({ message: "เข้าสู่ระบบสำเร็จ" });
  } catch (error) {
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
  }
}
