import { getSession } from "./session";
import {
  isSetupComplete,
  isSetupRateLimited,
  recordSetupFailure,
  verifySetupToken,
} from "./setupToken";

export const SETUP_TOKEN_HEADER = "x-setup-token";

type GuardRequest = {
  cookies: Partial<Record<string, string>>;
  headers?: Partial<Record<string, string | string[]>>;
  socket?: { remoteAddress?: string | undefined };
};

/**
 * ยังอยู่ในช่วงติดตั้งครั้งแรกหรือไม่ — จบเมื่อเข้าสู่ระบบสำเร็จครั้งแรก
 * (ดูเหตุผลที่ไม่ใช้ "มี dbconfig.json แล้ว" เป็นเกณฑ์ ใน lib/setupToken.ts)
 */
export function isBootstrapPhase(): boolean {
  return !isSetupComplete();
}

function headerValue(req: GuardRequest, name: string): string | undefined {
  const raw = req.headers?.[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function clientIp(req: GuardRequest): string {
  const xff = headerValue(req, "x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export type ConfigAccess = { ok: true } | { ok: false; status: number; error: string };

/**
 * ใครแก้การตั้งค่าฐานข้อมูลได้บ้าง
 *
 *  - มี session ที่ถูกต้อง → ผ่าน (กรณีปกติหลังติดตั้งเสร็จ)
 *  - ยังไม่เคยตั้งค่า (bootstrap) → ต้องแนบรหัสติดตั้งครั้งแรกมาด้วย
 *  - นอกนั้น → ปฏิเสธ
 *
 * เดิมช่วง bootstrap เปิดให้ทุกคนแก้ได้โดยไม่ต้องพิสูจน์ตัวตนเลย ใครก็ตามใน
 * วง LAN ที่เข้าหน้าเว็บทันก่อนเจ้าหน้าที่ จะชี้ฐานข้อมูลไปเซิร์ฟเวอร์ของตัวเอง
 * แล้วเข้าสู่ระบบด้วยบัญชีที่ตัวเองสร้างขึ้น จากนั้นก็ถือ session จริงกลับมา
 * ชี้ฐานข้อมูลไปที่ HOSxP ของจริงเพื่ออ่านข้อมูลผู้ป่วยได้ทั้งหมด
 */
export function checkConfigAccess(req: GuardRequest): ConfigAccess {
  if (getSession(req) !== null) return { ok: true };

  if (!isBootstrapPhase()) {
    return { ok: false, status: 401, error: "กรุณาเข้าสู่ระบบ" };
  }

  const ip = clientIp(req);
  if (isSetupRateLimited(ip)) {
    return {
      ok: false,
      status: 429,
      error: "ใส่รหัสติดตั้งผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่",
    };
  }

  if (!verifySetupToken(headerValue(req, SETUP_TOKEN_HEADER))) {
    recordSetupFailure(ip);
    return {
      ok: false,
      status: 401,
      error: "รหัสติดตั้งครั้งแรกไม่ถูกต้อง (ดูรหัสได้จากหน้าจอตัวช่วยติดตั้ง)",
    };
  }

  return { ok: true };
}
