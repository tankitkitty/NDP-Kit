import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { getValidNhsoToken } from "../../../lib/nhsoToken";

// ตรวจสอบสิทธิ "สด" กับ NHSO online โดยใช้ token จากตาราง nhso_token (ไม่ต้องใช้ agent)
// ยังไม่เขียนลง HOSxP — คืนผลให้แสดงอย่างเดียว
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const pid = typeof req.body?.pid === "string" ? req.body.pid.trim() : "";
  if (!pid) {
    return res.status(400).json({ error: "ต้องระบุเลขบัตรประชาชน (pid)" });
  }

  // 1) เลือก token ของเจ้าหน้าที่ที่ login (ใช้ได้ + ยังไม่หมดอายุ)
  const token = await getValidNhsoToken(session.loginname);
  if (!token) {
    return res.status(200).json({
      ok: false,
      reason: "no-token",
      message: "ไม่มี NHSO token ที่ใช้ได้ (ไม่มี หรือหมดอายุ) — กรุณาเข้าระบบ NHSO ในโปรแกรม HOSxP เพื่อรับ token ใหม่ก่อน",
    });
  }

  // 2) endpoint ตรวจสอบสิทธิ online ตั้งค่าผ่าน env NHSO_CHECKRIGHT_URL (ใส่ {pid} ตรงตำแหน่ง pid ได้)
  //    ยังไม่ยิงถ้าไม่ได้ตั้งค่า เพื่อกันการยิงมั่วไปที่ระบบจริงของ สปสช.
  const endpoint = process.env.NHSO_CHECKRIGHT_URL;
  if (!endpoint) {
    return res.status(200).json({
      ok: false,
      reason: "no-endpoint",
      message: `มี NHSO token พร้อมใช้ (หมดอายุ ${token.expire ? token.expire.toISOString() : "-"}) แต่ยังไม่ได้ตั้งค่า endpoint ตรวจสอบสิทธิ (NHSO_CHECKRIGHT_URL) — รอสเปก API`,
    });
  }

  // 3) ยิง NHSO online ด้วย Bearer token แล้วคืน response ดิบ (ยังไม่ map เพราะต้องยืนยัน schema กับเอกสารจริง)
  try {
    const method = (process.env.NHSO_CHECKRIGHT_METHOD || "GET").toUpperCase();
    const url = endpoint.includes("{pid}") ? endpoint.replace("{pid}", encodeURIComponent(pid)) : endpoint;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token.token}`,
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (method === "POST") init.body = JSON.stringify({ pid });

    const r = await fetch(url, init);
    const raw = await r.json().catch(() => null);
    if (!r.ok) {
      return res.status(200).json({ ok: false, reason: "nhso-error", message: `NHSO ตอบกลับ HTTP ${r.status}`, raw });
    }
    return res.status(200).json({ ok: true, raw });
  } catch (error: any) {
    return res.status(200).json({ ok: false, reason: "fetch-error", message: error?.message || "เรียก NHSO ไม่สำเร็จ" });
  }
}
