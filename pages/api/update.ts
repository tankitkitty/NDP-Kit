import { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "../../lib/session";
import { getAppVersion } from "../../lib/registry";
import {
  ASSET_URL,
  buildUpdateScript,
  fetchLatestVersion,
  getInstallRoot,
  isNewer,
} from "../../lib/updater";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  const root = getInstallRoot();
  const current = getAppVersion();

  if (req.method === "GET") {
    if (!root) {
      // รันจากซอร์สโค้ดของนักพัฒนา ไม่ได้ติดตั้งผ่านตัวช่วย จึงอัปเดตในตัวไม่ได้
      return res.status(200).json({ supported: false, current });
    }
    try {
      const latest = await fetchLatestVersion();
      return res.status(200).json({
        supported: true,
        current,
        latest,
        hasUpdate: isNewer(latest, current),
      });
    } catch (error: any) {
      return res.status(502).json({
        error: `ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ: ${error?.message || "เชื่อมต่อ GitHub ไม่ได้"}`,
      });
    }
  }

  if (req.method === "POST") {
    if (!root) {
      return res.status(400).json({
        error: "เครื่องนี้ไม่ได้ติดตั้งผ่านตัวช่วยติดตั้ง จึงอัปเดตจากหน้าเว็บไม่ได้",
      });
    }
    try {
      // เขียนสคริปต์ใหม่ทุกครั้ง เพื่อให้เครื่องที่ติดตั้งด้วยตัวช่วยรุ่นเก่าใช้ได้ด้วย
      const scriptPath = path.join(root, "update.ps1");
      fs.writeFileSync(scriptPath, buildUpdateScript(ASSET_URL), "utf8");

      // ต้อง detached เพราะสคริปต์จะปิด process นี้ทิ้งระหว่างทาง
      // ถ้าไม่แยกกลุ่ม process ตัวอัปเดตจะโดนปิดตามไปด้วยแล้วค้างครึ่งทาง
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
        { detached: true, stdio: "ignore", windowsHide: true }
      );
      child.unref();

      return res.status(200).json({
        message: "เริ่มอัปเดตแล้ว โปรแกรมจะปิดและเปิดใหม่เอง กรุณารอสักครู่แล้วรีเฟรชหน้าเว็บ",
      });
    } catch (error: any) {
      return res.status(500).json({
        error: `เริ่มอัปเดตไม่สำเร็จ: ${error?.message || ""}`,
      });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}
