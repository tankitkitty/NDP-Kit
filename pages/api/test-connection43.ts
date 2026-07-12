import { NextApiRequest, NextApiResponse } from "next";
import mysql from "mysql2/promise";
import { parseDbConfig43, readStoredConfig43 } from "../../lib/db43";
import { isConfigAccessAllowed } from "../../lib/authGuard";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isConfigAccessAllowed(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  let config;
  try {
    config = parseDbConfig43(req.body);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "ข้อมูลการตั้งค่าไม่ถูกต้อง" });
  }

  if (!config.password) {
    const stored = readStoredConfig43();
    if (stored?.password) {
      config.password = stored.password;
    }
  }

  let connection;
  try {
    connection = await mysql.createConnection(config);
    await connection.execute("SELECT 1");
    return res.status(200).json({ message: "เชื่อมต่อฐานข้อมูล 43 แฟ้มสำเร็จ" });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "ไม่สามารถเชื่อมต่อฐานข้อมูลได้" });
  } finally {
    if (connection) {
      await connection.end().catch(() => undefined);
    }
  }
}
