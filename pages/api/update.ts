import { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "../../lib/session";
import { getAppVersion } from "../../lib/registry";
import {
  clearUpdateStage,
  fetchVersions,
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
  // เพราะระหว่างนี้ยังไม่ควรไปอ่านรายการเวอร์ชันซ้ำ (ช้าและไม่จำเป็น)
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
      // ?force=1 มาจากปุ่มตรวจสอบเวอร์ชันที่ผู้ใช้กดเอง ต้องได้คำตอบสดไม่ใช่ของที่พักไว้
      const versions = await fetchVersions(req.query.force !== undefined);
      const latest = versions[0].tag;
      return res.status(200).json({
        supported: true,
        current,
        latest,
        hasUpdate: isNewer(latest, current),
        // ส่งทั้งรายการไปด้วย เพื่อให้ผู้ดูแลเลือกติดตั้งเวอร์ชันอื่นได้ เช่นถอยกลับ
        // ไปตัวก่อนหน้าเมื่อเวอร์ชันใหม่มีปัญหา ไม่ต้องรอผู้พัฒนาปล่อยตัวแก้
        versions: versions.map((v) => ({
          tag: v.tag,
          fileName: v.fileName,
          sizeBytes: v.sizeBytes,
        })),
      });
    } catch (error: any) {
      return res.status(502).json({
        error: `ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ: ${error?.message || "เชื่อมต่อ Google Drive ไม่ได้"}`,
      });
    }
  }

  if (req.method === "POST") {
    if (!root) {
      return res.status(400).json({
        error: "เครื่องนี้ไม่ได้ติดตั้งผ่านตัวช่วยติดตั้ง จึงอัปเดตจากหน้าเว็บไม่ได้",
      });
    }

    // ต้องรู้เลขเวอร์ชันก่อนเริ่ม เพราะที่อยู่ของแพ็กเกจผูกกับไฟล์ของเวอร์ชันนั้น
    // ถ้าอ่านรายการไม่ได้ก็บอกไปเลยตั้งแต่ตอนนี้ ดีกว่าปล่อยให้เริ่มแล้วไปตายกลางทาง
    //
    // ผู้ใช้ระบุเวอร์ชันมาได้ (เลือกเองจากหน้าเว็บ) ถ้าไม่ระบุถือว่าเอาตัวล่าสุด
    // ต้องตรวจว่าเวอร์ชันที่ขอมามีอยู่จริง ไม่ใช่เชื่อค่าที่ส่งมาจากเบราว์เซอร์ตรงๆ
    let target: string;
    try {
      // กำลังจะดาวน์โหลดจริง ต้องถามสดเสมอ ไม่ใช้ค่าที่พักไว้
      const versions = await fetchVersions(true);
      const asked = typeof req.body?.target === "string" ? req.body.target.trim() : "";
      if (asked) {
        const hit = versions.find((v) => v.tag === asked);
        if (!hit) {
          return res.status(400).json({ error: `ไม่พบเวอร์ชัน ${asked} ในรายการที่ติดตั้งได้` });
        }
        target = hit.tag;
      } else {
        target = versions[0].tag;
      }
    } catch (error: any) {
      return res.status(502).json({
        error: `ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ: ${error?.message || "เชื่อมต่อ Google Drive ไม่ได้"}`,
      });
    }

    clearUpdateStage();

    // ดาวน์โหลดและแตกไฟล์ด้วยตัวโปรแกรมเอง แล้วตอบกลับทันทีไม่ให้ผู้ใช้ค้างรอ
    // ความคืบหน้าและความผิดพลาดทั้งหมดรายงานผ่านไฟล์สถานะที่หน้าเว็บถามเป็นระยะ
    void stageUpdate(target)
      .then(() => restartIntoNewVersion(root))
      .catch(() => {
        // stageUpdate บันทึกสาเหตุไว้ให้แล้ว ไม่ต้องทำอะไรเพิ่ม
      });

    return res.status(200).json({ message: "เริ่มอัปเดตแล้ว", target });
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
