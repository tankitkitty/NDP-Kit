import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/session";
import { query } from "../../../lib/db";
import { selectOnly } from "../../../lib/precheck/readonly";
import { SERVER_FIXES } from "../../../lib/precheck";

/**
 * รันคำสั่งแก้ไข (UPDATE) เฉพาะที่กำหนดไว้ล่วงหน้าฝั่ง server เท่านั้น
 * - ไม่รับ SQL จาก client เด็ดขาด — รับแค่ checkId แล้ว map ไปยังคำสั่งใน SERVER_FIXES
 * - ต้องส่ง confirm: true (ผู้ใช้กดยืนยันใน modal ที่เตือนเรื่อง MyISAM/สำรองข้อมูลแล้ว)
 * - ถ้า MySQL user ที่ตั้งค่าไว้เป็น SELECT-only การรันจะล้มเหลวอย่างปลอดภัย
 *   (ให้ copy SQL ไปรันใน SQL Query ของ HOSxP แทน)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const checkId = typeof req.body?.checkId === "string" ? req.body.checkId : "";
  const fix = SERVER_FIXES[checkId];
  if (!fix) {
    return res.status(400).json({ error: "หัวข้อนี้ไม่มีคำสั่งแก้ไขที่รันจากระบบได้ — ให้ copy SQL ไปรันเอง" });
  }
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: "ต้องกดยืนยันก่อนรันคำสั่งแก้ไข" });
  }

  try {
    const before: any = await selectOnly(fix.countSql);
    const expected = Number(before?.[0]?.cnt ?? 0);
    if (expected === 0) {
      return res.status(200).json({ message: "ไม่มีรายการที่ต้องแก้แล้ว", affectedRows: 0 });
    }

    // จุดเดียวในฟีเจอร์นี้ที่เขียนลงฐาน HOSxP — รันคำสั่งที่กำหนดตายตัวใน SERVER_FIXES
    const result: any = await query(fix.sql);
    const affected = Number(result?.affectedRows ?? 0);
    console.log(
      `[precheck/fix] ${new Date().toISOString()} user=${session.loginname} check=${checkId} expected=${expected} affected=${affected}`
    );
    return res.status(200).json({
      message: `แก้ไขสำเร็จ ${affected} รายการ (โดย ${session.loginname})`,
      affectedRows: affected,
    });
  } catch (error: any) {
    const msg: string = error?.message || "รันคำสั่งแก้ไขไม่สำเร็จ";
    // สิทธิ์ไม่พอ (user เป็น SELECT-only) — แนะนำทาง copy แทน
    if (/denied|privilege/i.test(msg)) {
      return res.status(403).json({
        error:
          "MySQL user ที่ตั้งค่าไว้ไม่มีสิทธิ์ UPDATE (ตั้งใจให้ read-only) — ให้ copy คำสั่ง SQL ไปรันใน SQL Query ของ HOSxP แทน",
      });
    }
    return res.status(500).json({ error: msg });
  }
}
