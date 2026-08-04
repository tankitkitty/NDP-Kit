import { NextApiRequest, NextApiResponse } from "next";
import fs from "fs/promises";
import path from "path";
import { parseDbConfig, readStoredConfig } from "../../lib/db";
import { checkConfigAccess } from "../../lib/authGuard";
import { writeSecretJsonFile } from "../../lib/configSecurity";
import { clearSetupToken } from "../../lib/setupToken";

const configPath = path.join(process.cwd(), "data", "dbconfig.json");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const access = checkConfigAccess(req);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

  if (req.method === "GET") {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);
      const { password, ...rest } = config;
      return res.status(200).json({ config: { ...rest, hasPassword: Boolean(password) } });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถอ่านการตั้งค่าได้" });
    }
  }

  if (req.method === "POST") {
    let config;
    try {
      config = parseDbConfig(req.body);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "ข้อมูลการตั้งค่าไม่ถูกต้อง" });
    }

    if (!config.password) {
      const stored = readStoredConfig();
      if (stored?.password) {
        config.password = stored.password;
      }
    }

    try {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await writeSecretJsonFile(configPath, config);
      // ไฟล์นี้ถูกสร้างแล้ว = จบช่วงติดตั้ง ต่อจากนี้ต้องมี session เสมอ
      // รหัสติดตั้งครั้งแรกจึงหมดหน้าที่ ลบทิ้งไม่ให้ค้างอยู่บนดิสก์
      clearSetupToken();
      return res.status(200).json({ message: "บันทึกการตั้งค่าฐานข้อมูลสำเร็จ" });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถบันทึกการตั้งค่าได้" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}
