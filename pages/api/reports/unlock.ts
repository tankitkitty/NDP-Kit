import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_MAX_AGE_SECONDS,
  checkPassword,
  createAdminCookieValue,
  isAdminMode,
} from "../../../lib/reports/admin";

/**
 * เปิด/ปิดเมนูลับของผู้ดูแล
 *   GET    — ตอนนี้เปิดอยู่ไหม
 *   POST   — ส่งรหัสมาเพื่อเปิด
 *   DELETE — ปิด (ออกจากโหมดผู้ดูแล)
 *
 * ตรวจรหัสฝั่งเซิร์ฟเวอร์แล้วออกคุกกี้ที่เซ็นชื่อไว้ ไม่ให้เบราว์เซอร์ตั้งสถานะเอง
 * เพราะถ้าเชื่อฝั่งเบราว์เซอร์ การซ่อนเมนูจะไม่ได้กันคำขอที่ยิงเข้ามาตรงๆ เลย
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });

  if (req.method === "GET") {
    return res.status(200).json({ admin: isAdminMode(req) });
  }

  if (req.method === "POST") {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!checkPassword(password)) {
      return res.status(401).json({ error: "รหัสไม่ถูกต้อง" });
    }
    res.setHeader(
      "Set-Cookie",
      `${ADMIN_COOKIE_NAME}=${createAdminCookieValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_MAX_AGE_SECONDS}`
    );
    return res.status(200).json({ admin: true });
  }

  if (req.method === "DELETE") {
    res.setHeader(
      "Set-Cookie",
      `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
    return res.status(200).json({ admin: false });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end("Method Not Allowed");
}
