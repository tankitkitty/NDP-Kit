import { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "../../lib/session";
import { getAppVersion } from "../../lib/registry";
import {
  ASSET_URL,
  buildUpdateScript,
  clearUpdateStage,
  fetchLatestVersion,
  getInstallRoot,
  isNewer,
  readUpdateStage,
  writeUpdateStage,
} from "../../lib/updater";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  const root = getInstallRoot();
  const current = getAppVersion();

  // หน้าเว็บถามขั้นตอนที่กำลังทำอยู่ระหว่างอัปเดต แยกจากการตรวจเวอร์ชันใหม่
  // เพราะระหว่างนี้ยังไม่ควรไปเรียก GitHub ซ้ำ (ช้าและไม่จำเป็น)
  if (req.method === "GET" && req.query.stage !== undefined) {
    return res.status(200).json({ stage: readUpdateStage(), current });
  }

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
      // ล้างสถานะของรอบก่อนทิ้ง ไม่งั้นหน้าเว็บจะอ่านเจอ done/failed ของเก่า
      // แล้วรายงานว่าเสร็จตั้งแต่ยังไม่เริ่ม
      clearUpdateStage();

      const scriptPath = path.join(root, "update.ps1");
      fs.writeFileSync(scriptPath, buildUpdateScript(ASSET_URL), "utf8");

      // ทำเครื่องหมายว่า "สั่งไปแล้ว" ก่อนเปิดสคริปต์ ถ้าค้างอยู่ที่สถานะนี้นานผิดปกติ
      // แปลว่าสคริปต์ไม่เคยถูกเรียกให้ทำงาน (มักโดนโปรแกรมป้องกันไวรัสสกัด)
      // ซึ่งเป็นคนละเรื่องกับดาวน์โหลดช้า และต้องแนะนำผู้ใช้คนละแบบ
      writeUpdateStage("starting");

      // ต้อง detached เพราะสคริปต์จะปิด process นี้ทิ้งระหว่างทาง
      // ถ้าไม่แยกกลุ่ม process ตัวอัปเดตจะโดนปิดตามไปด้วยแล้วค้างครึ่งทาง
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
        { detached: true, stdio: "ignore", windowsHide: true }
      );
      // ChildProcess ที่ไม่มีคนดัก error จะโยน exception ออกมาแบบไม่มีใครรับ
      // แล้วทำให้ทั้งเซิร์ฟเวอร์ดับ ทั้งที่ผู้ใช้แค่กดปุ่มอัปเดต
      child.on("error", () => undefined);
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
