import { NextApiRequest, NextApiResponse } from "next";
import { initializeSchema43, getExistingTables43, SCHEMA43_TABLES } from "../../lib/db43";
import { getSession } from "../../lib/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const before = await getExistingTables43();
    await initializeSchema43();
    const after = await getExistingTables43();
    const created = SCHEMA43_TABLES.filter((t) => !before.includes(t) && after.includes(t));
    const skipped = SCHEMA43_TABLES.filter((t) => before.includes(t));

    const message =
      created.length > 0
        ? `สร้างตารางใหม่ ${created.length} ตาราง (${created.join(", ")})` +
          (skipped.length > 0 ? ` — มีอยู่แล้วไม่สร้างซ้ำ ${skipped.length} ตาราง (${skipped.join(", ")})` : "")
        : `ตารางทั้งหมด ${after.length} ตารางมีอยู่แล้ว ไม่ได้สร้างซ้ำ`;

    return res.status(200).json({ message, created, skipped });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถสร้างตารางได้" });
  }
}
