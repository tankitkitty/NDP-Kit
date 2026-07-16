import { query } from "./db";

export type NhsoTokenInfo = { token: string; expire: Date | null; cid: string };

// ถอด exp (วินาที epoch) จาก JWT เพื่อใช้เป็นตัวสำรองเช็คหมดอายุ
function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * เลือก token ของเจ้าหน้าที่ที่ login อยู่ ซึ่ง "ยังใช้ได้และยังไม่หมดอายุ"
 * - map officer_login_name -> officer.officer_cid -> nhso_token.cid
 * - ต้อง is_invalid = 'N'
 * - ต้องยังไม่หมดอายุ: ใช้ access_token_expire เป็นหลัก (ตรงกับ exp ใน JWT)
 *   ถ้าคอลัมน์ว่างค่อยถอด exp จาก JWT
 * คืน null ถ้าไม่มี token ที่ใช้ได้ (เช่น ยังไม่ได้ล็อกอิน NHSO ใน HOSxP หรือ token หมดอายุหมดแล้ว)
 */
export async function getValidNhsoToken(loginname: string): Promise<NhsoTokenInfo | null> {
  const rows: any = await query(
    `SELECT t.token, t.access_token_expire AS expire, t.cid
     FROM officer o
     JOIN nhso_token t ON t.cid = o.officer_cid
     WHERE o.officer_login_name = ?
       AND t.is_invalid = 'N'
       AND t.token IS NOT NULL AND t.token <> ''
     ORDER BY t.access_token_expire DESC`,
    [loginname]
  );

  const now = Date.now();
  for (const r of rows) {
    const expMs = r.expire ? new Date(r.expire).getTime() : jwtExpMs(r.token);
    if (expMs && expMs > now) {
      return { token: r.token, expire: r.expire ? new Date(r.expire) : new Date(expMs), cid: r.cid };
    }
  }
  return null;
}
