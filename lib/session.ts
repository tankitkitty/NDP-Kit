import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const secretFilePath = path.join(process.cwd(), "data", ".session-secret");
let cachedSecret: string | null = null;

function getSecret(): string {
  // ใช้ค่าจาก environment ก่อนเสมอ (แนะนำสำหรับ production หลายเครื่อง)
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;

  // ถ้าไม่ได้ตั้ง env ให้สร้าง secret สุ่มเฉพาะเครื่องแล้วเก็บลงไฟล์
  // (gitignored) เพื่อให้ cookie ยังใช้ได้ข้ามการรีสตาร์ท และทุกการติดตั้ง
  // ได้ key ที่เดาไม่ได้โดยไม่ต้องตั้งค่าเอง — ไม่มีค่าตายตัวที่รู้กันทั่วไปอีกต่อไป
  try {
    if (fs.existsSync(secretFilePath)) {
      const stored = fs.readFileSync(secretFilePath, "utf-8").trim();
      if (stored) {
        cachedSecret = stored;
        return cachedSecret;
      }
    }
    const generated = crypto.randomBytes(48).toString("hex");
    fs.mkdirSync(path.dirname(secretFilePath), { recursive: true });
    fs.writeFileSync(secretFilePath, generated, { encoding: "utf-8", mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  } catch {
    // กรณีสุดท้าย (เช่น ระบบไฟล์อ่านอย่างเดียว): สุ่ม secret ไว้ในหน่วยความจำ
    // cookie จะหมดอายุเมื่อรีสตาร์ท แต่ค่าไม่เคยเป็นค่าคงที่ที่เดาได้
    cachedSecret = crypto.randomBytes(48).toString("hex");
    return cachedSecret;
  }
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionValue(loginname: string): string {
  const encoded = Buffer.from(loginname, "utf-8").toString("base64url");
  const expires = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${encoded}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined): { loginname: string } | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [encoded, expiresStr, signature] = parts;
  const payload = `${encoded}.${expiresStr}`;
  const expected = sign(payload);

  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  try {
    const loginname = Buffer.from(encoded, "base64url").toString("utf-8");
    return { loginname };
  } catch {
    return null;
  }
}

export function getSession(req: { cookies: Partial<Record<string, string>> }): { loginname: string } | null {
  return verifySessionValue(req.cookies[SESSION_COOKIE_NAME]);
}
