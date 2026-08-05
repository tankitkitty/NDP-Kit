import { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "../../lib/session";
import { getAppVersion } from "../../lib/registry";
import {
  clearUpdateStage,
  fetchLatestVersion,
  getInstallRoot,
  hasStagedUpdate,
  isNewer,
  readUpdateError,
  readUpdateStage,
  stageUpdate,
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
    return res.status(200).json({
      stage: readUpdateStage(),
      error: readUpdateError(),
      current,
    });
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

    clearUpdateStage();

    // ดาวน์โหลดและแตกไฟล์ด้วยตัวโปรแกรมเอง แล้วตอบกลับทันทีไม่ให้ผู้ใช้ค้างรอ
    // ความคืบหน้าและความผิดพลาดทั้งหมดรายงานผ่านไฟล์สถานะที่หน้าเว็บถามเป็นระยะ
    void stageUpdate()
      .then(() => restartIntoNewVersion(root))
      .catch(() => {
        // stageUpdate บันทึกสาเหตุไว้ให้แล้ว ไม่ต้องทำอะไรเพิ่ม
      });

    return res.status(200).json({ message: "เริ่มอัปเดตแล้ว" });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end("Method Not Allowed");
}

/**
 * สลับไฟล์และเปิดโปรแกรมใหม่
 *
 * ไฟล์ของโปรแกรมที่กำลังทำงานถูก Windows ล็อกไว้ จึงทับตรงๆ ไม่ได้ ตัวสลับจริง
 * อยู่ใน start.cmd ซึ่งทำงานตอนเปิดโปรแกรม หน้าที่ตรงนี้จึงเหลือแค่ปิดตัวเองแล้ว
 * ให้อะไรสักอย่างเปิดโปรแกรมขึ้นมาใหม่
 *
 * ใช้ cmd.exe แทน PowerShell เพราะพบที่หน่วยบริการจริงว่าระบบของเครื่องสกัดการ
 * เปิด PowerShell แบบซ่อนหน้าต่างจาก process เบื้องหลังไว้
 *
 * ถ้าเปิด cmd.exe ไม่ได้อีก ก็ยังไม่เสียหาย เพราะไฟล์ใหม่ถูกเตรียมไว้ครบแล้ว
 * การสลับจะเกิดเองตอนเปิดเครื่องหรือเปิดโปรแกรมครั้งถัดไป หน้าเว็บจะบอกผู้ใช้ตามนั้น
 */
function restartIntoNewVersion(root: string): void {
  if (!hasStagedUpdate()) return;

  try {
    const vbs = path.join(root, "start.vbs");
    // รอ 3 วินาทีให้เราปิดตัวเองเสร็จก่อน แล้วค่อยเปิดใหม่
    //
    // ใช้ ping หน่วงเวลาแทน timeout เพราะ timeout ต้องการ console จริงเป็น stdin
    // แต่ process ลูกตัวนี้ถูกตัด stdio ทิ้ง มันจะตอบ "Input redirection is not
    // supported" แล้วออกทันที กลายเป็นเปิดโปรแกรมใหม่ทับตอนตัวเก่ายังไม่ปิด
    const child = spawn(`ping -n 4 127.0.0.1 >nul & wscript.exe "${vbs}"`, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: true,
    });
    child.on("error", () => undefined);
    child.unref();

    writeUpdateStage("restarting");
    setTimeout(() => process.exit(0), 1500);
  } catch {
    // เปิดตัวใหม่ไม่ได้ก็ปล่อยไว้ที่สถานะ staged ให้หน้าเว็บแจ้งผู้ใช้เอง
  }
}
