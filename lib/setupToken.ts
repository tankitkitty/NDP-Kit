import crypto from "crypto";
import fs from "fs";
import path from "path";

const tokenFilePath = path.join(process.cwd(), "data", ".setup-token");
const setupDonePath = path.join(process.cwd(), "data", ".setup-done");
const mainConfigPath = path.join(process.cwd(), "data", "dbconfig.json");

// ตัวอักษรที่อ่านสับสนกันง่ายถูกตัดออกหมด (I, O, 0, 1) เพราะผู้ใช้ต้องอ่านรหัส
// จากหน้าจอตัวช่วยติดตั้งแล้วพิมพ์ใส่หน้าเว็บเอง
// เหลือพอดี 32 ตัว = 256 หารลงตัว จึงสุ่มด้วย % ได้โดยไม่เกิดความเอนเอียง
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 8;

let cachedToken: string | null = null;

function generate(): string {
  const bytes = crypto.randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function normalize(value: string): string {
  // ตัวช่วยติดตั้งแสดงรหัสแบบมีขีดคั่น (ABCD-2345) ให้อ่านง่าย
  // ผู้ใช้จะพิมพ์ขีดมาด้วยหรือไม่ก็ได้ และไม่ต้องสนตัวพิมพ์เล็ก/ใหญ่
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * รหัสสำหรับตั้งค่าครั้งแรก — ใช้เฉพาะช่วงที่ยังไม่มี data/dbconfig.json
 * (ดู lib/authGuard.ts) เมื่อตั้งค่าฐานข้อมูลเสร็จแล้วรหัสนี้จะหมดความหมาย
 *
 * ลำดับที่มา:
 *   1. env SETUP_TOKEN — ตัวช่วยติดตั้งสุ่มให้แล้วแสดงบนจอตอนติดตั้ง
 *   2. data/.setup-token — สำหรับคนที่รัน server.js เองโดยไม่ผ่านตัวช่วยติดตั้ง
 *      แอปจะสุ่มให้เองครั้งแรก เก็บไฟล์ไว้สิทธิ์ 0600 แล้วพิมพ์ลง log
 *      (ตัวช่วยติดตั้งเก็บ log ไว้ที่ C:\NDP-Kit\logs\app.log ดูได้จากเมนู 3)
 */
export function getSetupToken(): string {
  const fromEnv = process.env.SETUP_TOKEN;
  if (fromEnv && normalize(fromEnv)) return normalize(fromEnv);

  if (cachedToken) return cachedToken;

  try {
    if (fs.existsSync(tokenFilePath)) {
      const stored = normalize(fs.readFileSync(tokenFilePath, "utf-8"));
      if (stored) {
        cachedToken = stored;
        return cachedToken;
      }
    }
    const generated = generate();
    fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true });
    fs.writeFileSync(tokenFilePath, generated, { encoding: "utf-8", mode: 0o600 });
    cachedToken = generated;
    console.log(
      `\n[NDP-Kit] รหัสสำหรับตั้งค่าครั้งแรก: ${generated.slice(0, 4)}-${generated.slice(4)}\n` +
        `[NDP-Kit] ใช้กรอกที่หน้าตั้งค่าการเชื่อมต่อ เมื่อตั้งค่าฐานข้อมูลเสร็จแล้วรหัสนี้จะใช้ไม่ได้อีก\n`
    );
    return cachedToken;
  } catch {
    // ระบบไฟล์เขียนไม่ได้ (เช่น mount แบบอ่านอย่างเดียว) — สุ่มไว้ในหน่วยความจำ
    // รหัสจะเปลี่ยนทุกครั้งที่รีสตาร์ท แต่ไม่มีทางเป็นค่าที่เดาได้
    cachedToken = generate();
    console.log(
      `\n[NDP-Kit] รหัสสำหรับตั้งค่าครั้งแรก: ${cachedToken.slice(0, 4)}-${cachedToken.slice(4)}\n`
    );
    return cachedToken;
  }
}

/**
 * ช่วงติดตั้งจบลงเมื่อ "เข้าสู่ระบบสำเร็จครั้งแรก" ไม่ใช่ตอนบันทึกค่าฐานข้อมูล
 *
 * เดิมปิดตอนบันทึกค่าสำเร็จ ซึ่งผิด เพราะขั้นตอนตามคู่มือคือกด Save Config แล้ว
 * ต่อด้วย Test Connection ตอนนั้นยังล็อกอินไม่ได้ (ยังไม่รู้ด้วยซ้ำว่าต่อฐานติดไหม)
 * พอบันทึกเสร็จรหัสติดตั้งถูกลบทันที ปุ่ม Test Connection จึงถูกปฏิเสธ 401 ทุกครั้ง
 *
 * การล็อกอินได้สำเร็จเป็นหลักฐานว่าตั้งค่าฐานข้อมูลถูกต้องแล้วจริง และมีเจ้าหน้าที่
 * ตัวจริงเข้ามาดูแลแล้ว จึงเป็นจุดปิดที่ถูกต้องทั้งด้านการใช้งานและความปลอดภัย
 */
export function isSetupComplete(): boolean {
  try {
    return fs.existsSync(setupDonePath);
  } catch {
    return false;
  }
}

export function markSetupComplete(): void {
  try {
    fs.mkdirSync(path.dirname(setupDonePath), { recursive: true });
    fs.writeFileSync(setupDonePath, new Date().toISOString(), {
      encoding: "utf-8",
      mode: 0o600,
    });
    // รหัสติดตั้งหมดหน้าที่แล้ว ลบไฟล์ทิ้งไม่ให้เหลือความลับค้างบนดิสก์
    if (fs.existsSync(tokenFilePath)) fs.unlinkSync(tokenFilePath);
    cachedToken = null;
  } catch {
    // เขียนไม่ได้ก็ยังปลอดภัย เพราะยังต้องมี session ถึงจะแก้ค่าตั้งค่าได้อยู่ดี
  }
}

/**
 * เครื่องที่ "เริ่มโปรแกรมขึ้นมาโดยมี dbconfig.json อยู่แล้ว" คือเครื่องที่ติดตั้ง
 * เสร็จไปตั้งแต่รอบก่อน รวมถึงเครื่องที่อัปเกรดมาจากรุ่นที่ยังไม่มีไฟล์ marker นี้
 * ต้องถือว่าจบช่วงติดตั้งทันที ไม่งั้นการอัปเดตโปรแกรมจะเปิดช่องให้ใช้รหัสติดตั้ง
 * แก้ค่าฐานข้อมูลได้อีกครั้งโดยไม่ต้องล็อกอิน
 *
 * ทำงานตอนโหลดโมดูลครั้งเดียวเท่านั้น จึงไม่ไปปิดช่วงติดตั้งของเครื่องใหม่ที่เพิ่ง
 * กด Save Config ระหว่างที่โปรแกรมกำลังทำงานอยู่
 */
(function migrateSetupState() {
  try {
    if (fs.existsSync(mainConfigPath) && !fs.existsSync(setupDonePath)) {
      markSetupComplete();
    }
  } catch {
    // ตรวจไม่ได้ก็ปล่อยไป ยังมีการตรวจ session เป็นด่านหลักอยู่
  }
})();

export function verifySetupToken(provided: string | undefined): boolean {
  if (isSetupComplete()) return false;
  if (!provided) return false;
  const expected = Buffer.from(getSetupToken(), "utf-8");
  const actual = Buffer.from(normalize(provided), "utf-8");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}


// จำกัดการเดารหัสต่อ IP เช่นเดียวกับหน้าเข้าสู่ระบบ เพราะรหัส 8 ตัวจากชุด 32 ตัว
// จะปลอดภัยจริงก็ต่อเมื่อเดารัวๆ ไม่ได้
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstAt: number }>();

export function isSetupRateLimited(ip: string): boolean {
  const rec = failedAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > WINDOW_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILED_ATTEMPTS;
}

export function recordSetupFailure(ip: string): void {
  const now = Date.now();
  if (failedAttempts.size >= 500) {
    for (const [key, rec] of failedAttempts) {
      if (now - rec.firstAt > WINDOW_MS) failedAttempts.delete(key);
    }
  }
  const rec = failedAttempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}
