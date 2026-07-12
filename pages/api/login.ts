import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { query } from "../../lib/db";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../lib/session";

// จำกัดการลองเข้าสู่ระบบต่อ IP เพื่อกันการเดารหัสผ่านแบบ brute force
// เก็บในหน่วยความจำ (เหมาะกับแอปแบบ instance เดียวที่ติดตั้งในหน่วยบริการ)
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstAt: number }>();

function getClientIp(req: NextApiRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
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
    const passwordHash = crypto.createHash("md5").update(password).digest("hex");
    const rows: any = await query(
      "SELECT loginname, account_disable FROM opduser WHERE loginname = ? AND passweb = ? LIMIT 1",
      [loginname, passwordHash]
    );
    const user = rows[0];

    if (!user || user.account_disable === "Y") {
      recordFailure(ip);
      return res.status(401).json({ error: "Username หรือ Password ไม่ถูกต้อง" });
    }

    failedAttempts.delete(ip);

    const sessionValue = createSessionValue(user.loginname);
    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`
    );
    return res.status(200).json({ message: "เข้าสู่ระบบสำเร็จ" });
  } catch (error) {
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
  }
}
