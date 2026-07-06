import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { query } from "../../lib/db";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../lib/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
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
      return res.status(401).json({ error: "Username หรือ Password ไม่ถูกต้อง" });
    }

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
