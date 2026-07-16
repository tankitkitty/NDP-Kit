import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { getValidNhsoToken } from "../../../lib/nhsoToken";

// ตรวจว่าเจ้าหน้าที่ที่ login อยู่มี NHSO token ที่ใช้ได้และยังไม่หมดอายุหรือไม่
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }
  try {
    const info = await getValidNhsoToken(session.loginname);
    return res.status(200).json({
      hasValidToken: Boolean(info),
      expire: info?.expire ?? null,
      loginname: session.loginname,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถตรวจสอบ token ได้" });
  }
}
