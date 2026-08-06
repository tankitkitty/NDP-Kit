import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { query } from "../../lib/db";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../lib/session";
import { markSetupComplete } from "../../lib/setupToken";

/**
 * จำกัดการลองเข้าสู่ระบบต่อ IP เพื่อกันการเดารหัสผ่านแบบ brute force
 *
 * กติกา: ใส่ผิดครบ 10 ครั้ง (ภายในช่วงนับ 15 นาที) แล้วห้ามลองอีก 15 นาที
 * นับจาก "ครั้งที่ผิดครั้งสุดท้าย" ไม่ใช่ครั้งแรก
 *
 * เดิมนับถอยหลังจากครั้งแรกที่ผิด ซึ่งกลายเป็นว่าถ้าคนร้ายค่อยๆ ยิงให้ครบ 10 ครั้ง
 * ตอนท้ายของช่วง 15 นาที จะโดนห้ามแค่ไม่กี่วินาทีแล้วเริ่มยิงรอบใหม่ได้เลย
 *
 * เก็บในหน่วยความจำ (เหมาะกับแอปแบบ instance เดียวที่ติดตั้งในหน่วยบริการ)
 * รีสตาร์ทโปรแกรมแล้วตัวนับหายไปด้วย ซึ่งรับได้เพราะการรีสตาร์ทต้องเข้าถึงตัวเครื่อง
 */
const MAX_FAILED_ATTEMPTS = 10;
/** ช่วงเวลาที่นับสะสมจำนวนครั้งที่ผิด */
const WINDOW_MS = 15 * 60 * 1000;
/** ระยะเวลาห้ามลองใหม่ หลังผิดครบตามจำนวน */
const BAN_MS = 15 * 60 * 1000;

type AttemptRecord = { count: number; firstAt: number; blockedUntil: number };
const failedAttempts = new Map<string, AttemptRecord>();

/**
 * IP ของผู้เรียก ใช้เป็นกุญแจของตัวนับการล็อกอินผิด
 *
 * ห้ามเชื่อ x-forwarded-for โดยไม่มีเงื่อนไข เพราะโปรแกรมนี้รับ request ตรงจาก
 * เบราว์เซอร์ ไม่ได้อยู่หลัง reverse proxy ใครก็ใส่ header นี้เองมาคนละค่าทุกครั้ง
 * เพื่อให้ตัวนับขึ้นคนละช่อง แล้วเดารหัสผ่านได้ไม่จำกัด (รหัสผ่าน HOSxP เป็น MD5
 * ไม่มี salt ยิ่งต้องกันการเดาให้อยู่)
 *
 * ถ้าติดตั้งไว้หลัง proxy จริง ให้ตั้ง env TRUST_PROXY=1 เพื่อกลับไปอ่าน header
 */
function getClientIp(req: NextApiRequest): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/** ล้างของเก่าที่หมดอายุทั้งช่วงนับและช่วงห้าม เพื่อไม่ให้ map โตไม่หยุด */
function pruneExpired(now: number) {
  if (failedAttempts.size < 500) return;
  for (const [key, rec] of failedAttempts) {
    if (now >= rec.blockedUntil && now - rec.firstAt > WINDOW_MS) failedAttempts.delete(key);
  }
}

function checkRateLimit(ip: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = failedAttempts.get(ip);
  if (!rec) return { limited: false, retryAfterSec: 0 };

  if (now < rec.blockedUntil) {
    return { limited: true, retryAfterSec: Math.ceil((rec.blockedUntil - now) / 1000) };
  }

  // พ้นกำหนดห้ามแล้ว หรือช่วงนับหมดอายุไปเฉยๆ — เริ่มนับใหม่ให้ครบ 10 ครั้งอีกรอบ
  // ไม่งั้นพอครบกำหนด ใส่ผิดครั้งเดียวจะโดนห้ามอีก 15 นาทีทันที ซึ่งคนที่จำรหัสผ่าน
  // ไม่ได้จริงๆ จะเข้าไม่ได้ทั้งวัน
  if (rec.blockedUntil > 0 || now - rec.firstAt > WINDOW_MS) {
    failedAttempts.delete(ip);
  }
  return { limited: false, retryAfterSec: 0 };
}

function recordFailure(ip: string) {
  const now = Date.now();
  pruneExpired(now);
  const rec = failedAttempts.get(ip);

  if (!rec || now - rec.firstAt > WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }

  rec.count += 1;
  if (rec.count >= MAX_FAILED_ATTEMPTS) {
    // ครบโควตาแล้ว เริ่มจับเวลาห้าม 15 นาทีจากครั้งนี้
    rec.blockedUntil = now + BAN_MS;
  }
}

/**
 * คำขอนี้มาทาง HTTPS จริงหรือไม่
 *
 * ต้องดูจาก "ช่องทางจริง" ไม่ใช่ NODE_ENV แบบเดิม เพราะแพ็กเกจที่หน่วยบริการใช้ถูก
 * ตั้ง NODE_ENV=production เสมอ (Next ตั้งให้ใน server.js ของโหมด standalone)
 * แต่เปิดผ่าน http:// ธรรมดา — cookie ที่ติด Secure บนหน้า http จะถูกเบราว์เซอร์
 * ทิ้งทันที (ยกเว้น localhost) ผลคือเข้าจากเครื่องอื่นในวง LAN แล้วล็อกอิน "สำเร็จ"
 * แต่เด้งกลับหน้าล็อกอินวนไปไม่รู้จบ โดยไม่มีอะไรบอกสาเหตุ
 *
 * ตั้งแบบนี้จึงได้ทั้งสองอย่าง: ใช้ HTTPS เมื่อไหร่ cookie ก็ถูกล็อกด้วย Secure
 * ทันที ส่วนที่ยังเป็น http ก็ยังใช้งานได้ (ป้องกันด้วย HttpOnly + SameSite เท่าเดิม)
 */
function isSecureRequest(req: NextApiRequest): boolean {
  if ((req.socket as any)?.encrypted) return true;
  // อ่าน header ได้เฉพาะตอนบอกไว้ว่าอยู่หลัง proxy จริง ไม่งั้นใครก็ปลอมมาได้
  if (process.env.TRUST_PROXY === "1") {
    const proto = req.headers["x-forwarded-proto"];
    const value = Array.isArray(proto) ? proto[0] : proto;
    if (typeof value === "string" && value.split(",")[0].trim() === "https") return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.limited) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSec));
    // บอกเวลาที่เหลือจริง ถ้าน้อยกว่า 1 นาทีให้บอกเป็นวินาที ไม่งั้นจะขึ้นว่า
    // "อีก 1 นาที" ค้างอยู่นานจนดูเหมือนเวลาไม่เดิน
    const remain =
      rateLimit.retryAfterSec >= 60
        ? `${Math.ceil(rateLimit.retryAfterSec / 60)} นาที`
        : `${rateLimit.retryAfterSec} วินาที`;
    return res.status(429).json({
      error: `ใส่รหัสผ่านผิดครบ ${MAX_FAILED_ATTEMPTS} ครั้ง ระบบระงับการเข้าสู่ระบบชั่วคราว กรุณาลองใหม่อีกครั้งใน ${remain}`,
    });
  }

  const loginname = typeof req.body?.loginname === "string" ? req.body.loginname.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!loginname || !password) {
    return res.status(400).json({ error: "กรุณาระบุ Username และ Password" });
  }

  try {
    // HOSxP PCU เก็บผู้ใช้งานในตาราง officer โดย officer_login_password_md5
    // คือ MD5 ของรหัสผ่าน (HOSxP เก็บเป็นตัวพิมพ์ใหญ่) — เทียบแบบไม่สนตัวพิมพ์
    // ด้วย UPPER() ทั้งสองฝั่ง เพื่อให้ตรงกันไม่ว่าฐานจะเก็บเป็นพิมพ์เล็กหรือใหญ่
    const passwordHash = crypto.createHash("md5").update(password).digest("hex").toUpperCase();
    const rows: any = await query(
      `SELECT officer_login_name, officer_active
       FROM officer
       WHERE officer_login_name = ? AND UPPER(officer_login_password_md5) = ? LIMIT 1`,
      [loginname, passwordHash]
    );
    const user = rows[0];

    if (!user || user.officer_active === "N") {
      recordFailure(ip);
      return res.status(401).json({ error: "Username หรือ Password ไม่ถูกต้อง" });
    }

    failedAttempts.delete(ip);

    // เข้าสู่ระบบได้สำเร็จ = ตั้งค่าฐานข้อมูลถูกต้องแล้วจริง และมีเจ้าหน้าที่ตัวจริง
    // เข้ามาดูแลแล้ว จึงปิดช่วงติดตั้งตรงนี้ รหัสติดตั้งครั้งแรกจะใช้ไม่ได้อีก
    markSetupComplete();

    const sessionValue = createSessionValue(user.officer_login_name);
    const secureFlag = isSecureRequest(req) ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`
    );
    return res.status(200).json({ message: "เข้าสู่ระบบสำเร็จ" });
  } catch (error: any) {
    // เขียนสาเหตุจริงลง log เสมอ (ตัวช่วยติดตั้งเก็บไว้ที่ logs\app.log ดูได้จากเมนู 3)
    //
    // เดิมกลืน error ทิ้งทั้งหมด เหลือแต่ข้อความกว้างๆ บนหน้าจอ เวลาหน่วยบริการโทรมาว่า
    // "ล็อกอินไม่ได้" จึงไม่มีอะไรให้ไล่เลยว่าเป็นเพราะฐานล่ม รหัสผ่านฐานเปลี่ยน
    // ตาราง officer ไม่มี หรือ request เพี้ยน — ต้องไปนั่งเดาทีละอย่าง
    //
    // เก็บแค่รหัสความผิดพลาดของ MySQL ห้ามเขียนข้อความเต็มลง log
    //
    // เพราะ mysql2 ประกอบค่าลงใน SQL ฝั่ง client ข้อความ error ของฐานจึงมีชิ้นส่วน
    // ของ SQL ติดมาด้วยได้ ซึ่งในคำสั่งนี้มีทั้งชื่อผู้ใช้และ MD5 ของรหัสผ่านอยู่
    // ถ้าเผลอเขียนลง logs\app.log ก็เท่ากับทิ้งแฮชรหัสผ่านไว้ให้คนที่อ่านไฟล์ log ได้
    // เอาไปถอด ส่วนรหัสอย่าง ER_CANT_AGGREGATE_2COLLATIONS หรือ ECONNREFUSED
    // ก็พอให้ไล่สาเหตุได้แล้ว
    console.error(
      `[login] ${new Date().toISOString()} ล็อกอินล้มเหลว: ${error?.code || error?.name || "ไม่ระบุรหัส"}`
    );

    // ฐานข้อมูลตอบว่าเทียบ collation ไม่ได้ = ชื่อผู้ใช้ที่ส่งมามีอักขระที่คอลัมน์
    // เก็บไม่ได้ (เช่น emoji ในฐานที่คอลัมน์เป็น tis620) แปลว่าไม่มีทางตรงกับบัญชีใด
    // ถือเป็นรหัสผ่านผิดตามปกติ จะได้นับรวมในโควตา 10 ครั้งด้วย
    if (error?.code === "ER_CANT_AGGREGATE_2COLLATIONS") {
      recordFailure(ip);
      return res.status(401).json({ error: "Username หรือ Password ไม่ถูกต้อง" });
    }

    return res.status(500).json({
      error: "เข้าสู่ระบบไม่สำเร็จเพราะติดต่อฐานข้อมูลไม่ได้ — ให้ผู้ดูแลระบบดูรายละเอียดที่ logs\\app.log",
    });
  }
}
