import { execFileSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";

interface ConnectionTarget {
  host: string;
  port: number;
  user: string;
}

/**
 * รหัสผ่านที่เก็บไว้จะถูกเติมให้อัตโนมัติได้เฉพาะเมื่อปลายทางยังเป็น
 * host/port/user เดิมเท่านั้น
 *
 * ถ้าไม่ตรวจข้อนี้ ผู้ที่เปิดหน้าตั้งค่าได้จะพิมพ์ host เป็นเซิร์ฟเวอร์ของตัวเอง
 * แล้วเว้นช่องรหัสผ่านว่างไว้ แอปจะหยิบรหัสผ่าน MySQL ของหน่วยบริการไปเชื่อมต่อ
 * ให้ถึงเครื่องนั้น — เซิร์ฟเวอร์ปลายทางที่เตรียมไว้ดักสามารถขอ plugin
 * mysql_clear_password เพื่ออ่านรหัสผ่านเป็นข้อความธรรมดาได้ทันที
 * เท่ากับดูดรหัสผ่านฐานข้อมูล HOSxP ออกไปโดยไม่ต้องรู้ค่าเดิมเลย
 */
export function canReuseStoredPassword(
  stored: ConnectionTarget | null,
  incoming: ConnectionTarget
): boolean {
  if (!stored) return false;
  return (
    stored.host === incoming.host &&
    stored.port === incoming.port &&
    stored.user === incoming.user
  );
}

/**
 * ไฟล์ตั้งค่าเก็บรหัสผ่านฐานข้อมูลเป็นข้อความธรรมดา จึงต้องให้เฉพาะเจ้าของ
 * process อ่านได้ (0600) ให้เท่ากับที่ lib/session.ts ใช้กับ .session-secret
 *
 * mode ใน writeFile มีผลเฉพาะตอน "สร้างไฟล์ใหม่" — ถ้าไฟล์เดิมมีอยู่แล้วด้วย
 * สิทธิ์ 0644 การเขียนทับจะคงสิทธิ์เดิมไว้ จึงต้อง chmod ซ้ำทุกครั้งเพื่อซ่อม
 * ไฟล์ที่ถูกสร้างไว้ก่อนหน้านี้ด้วย (chmod ไม่มีผลบน Windows จึงกลืน error ทิ้ง)
 */
export async function writeSecretJsonFile(filePath: string, value: unknown): Promise<void> {
  const plain = JSON.stringify(value, null, 2);

  // เข้ารหัสก่อนเขียนถ้าเครื่องรองรับ ถ้าไม่รองรับ (เช่นเครื่องนักพัฒนาที่ไม่ใช่ Windows)
  // ยังเขียนเป็น JSON ธรรมดาต่อไป ดีกว่าตั้งค่าไม่ได้เลย
  const sealed = runDpapi("protect", plain);
  const content = sealed
    ? JSON.stringify({ enc: ENC_MARKER, data: sealed.trim() }, null, 2)
    : plain;

  await fsp.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
  await fsp.chmod(filePath, 0o600).catch(() => undefined);
}

/**
 * เข้ารหัสไฟล์ตั้งค่าฐานข้อมูลด้วย DPAPI ของ Windows (ขอบเขต LocalMachine)
 *
 * ทำไมถึงใช้ DPAPI ไม่ใช่การเข้ารหัสด้วยกุญแจที่เก็บไว้ในโปรแกรมเอง:
 * โปรแกรมต้องเปิดไฟล์อ่านเองได้ทุกครั้งที่เริ่มทำงาน โดยไม่มีคนมาพิมพ์รหัสให้
 * ถ้าเก็บกุญแจไว้ข้างๆ ไฟล์หรือฝังในโค้ด ใครก็ตามที่ได้ไฟล์ไปก็ได้กุญแจไปด้วย
 * เท่ากับล็อกประตูแล้วแขวนลูกกุญแจไว้ที่ลูกบิด
 *
 * DPAPI ให้ Windows เก็บกุญแจไว้ให้ในเครื่องนั้น โปรแกรมเรียกใช้ได้โดยไม่ต้องรู้ค่ากุญแจ
 * ผลคือ **ก๊อปไฟล์ไปเปิดที่เครื่องอื่นถอดไม่ออก** ซึ่งเป็นความเสี่ยงจริงที่ต้องกัน
 * (เช่น ไฟล์ติดไปกับการสำรองข้อมูล หรือมีคนก๊อปโฟลเดอร์ออกไป)
 *
 * สิ่งที่วิธีนี้ **กันไม่ได้**: คนที่ล็อกอินเข้าเครื่องนั้นได้อยู่แล้วและรันโปรแกรมเป็น
 * ก็ให้ Windows ถอดรหัสให้ได้เหมือนกัน — ป้องกันชั้นนั้นต้องใช้สิทธิ์ไฟล์ (ACL) ช่วย
 *
 * เลือกขอบเขต LocalMachine ไม่ใช่ CurrentUser เพราะเครื่องในหน่วยบริการมักมีหลาย
 * บัญชีผู้ใช้ ถ้าผูกกับบัญชีที่ตั้งค่าไว้ พอเปลี่ยนคนล็อกอินโปรแกรมจะเปิดฐานไม่ได้
 */
const ENC_MARKER = "dpapi-v1";

type EncryptedFile = { enc: typeof ENC_MARKER; data: string };

function isEncrypted(value: unknown): value is EncryptedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).enc === ENC_MARKER &&
    typeof (value as any).data === "string"
  );
}

/** เรียก PowerShell ทำงาน DPAPI ให้ — ส่งข้อมูลทาง stdin เลี่ยงข้อจำกัดความยาวบรรทัดคำสั่ง */
function runDpapi(mode: "protect" | "unprotect", input: string): string | null {
  if (process.platform !== "win32") return null;
  const script =
    `Add-Type -AssemblyName System.Security;` +
    `$in = [Console]::In.ReadToEnd();` +
    (mode === "protect"
      ? `$b = [System.Text.Encoding]::UTF8.GetBytes($in);` +
        `$o = [System.Security.Cryptography.ProtectedData]::Protect($b, $null, 'LocalMachine');` +
        `[Console]::Out.Write([Convert]::ToBase64String($o));`
      : `$b = [Convert]::FromBase64String($in);` +
        `$o = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'LocalMachine');` +
        `[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($o));`);

  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { input, encoding: "utf-8", timeout: 20000, windowsHide: true }
    );
    return out.trim() ? out : null;
  } catch {
    // เข้ารหัส/ถอดรหัสไม่ได้ (ไม่ใช่ Windows, PowerShell ถูกปิด, ไฟล์มาจากเครื่องอื่น)
    return null;
  }
}

/**
 * อ่านไฟล์ตั้งค่าที่อาจถูกเข้ารหัสไว้ คืน null ถ้าอ่านไม่ได้
 *
 * รองรับไฟล์เก่าที่ยังเป็น JSON ธรรมดาด้วย เพื่อให้เครื่องที่ติดตั้งไปแล้วอัปเดตมาแล้ว
 * ยังใช้งานต่อได้ทันทีโดยไม่ต้องตั้งค่าใหม่ (จะถูกเข้ารหัสให้เองในการบันทึกครั้งถัดไป)
 */
export function readSecretJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isEncrypted(parsed)) return parsed as T;

    const plain = runDpapi("unprotect", parsed.data);
    if (!plain) return null;
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

/** true = ไฟล์นี้ถูกเข้ารหัสไว้แล้ว (ใช้ตัดสินใจว่าต้องเข้ารหัสย้อนหลังหรือยัง) */
export function isFileEncrypted(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    return isEncrypted(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return false;
  }
}
