/**
 * รายการเวอร์ชันที่ปล่อยให้หน่วยบริการ อ่านจากโฟลเดอร์บน Google Drive
 *
 * ย้ายมาจาก GitHub Releases เมื่อ 6 ส.ค. 2569 เพราะเจอปัญหาสองอย่างพร้อมกัน
 *
 * 1. แพ็กเกจถูกสร้างโดย GitHub Actions วันนั้น Actions ล่มยาว (major outage)
 *    ไฟล์ของเวอร์ชันใหม่จึงไม่เคยถูกสร้าง ทั้งปุ่มอัปเดตในหน้าเว็บและตัวช่วยติดตั้ง
 *    หาเวอร์ชันใหม่ไม่เจอทั้งคู่ ไม่มีทางปล่อยเวอร์ชันได้เลยนอกจากรอ
 * 2. GitHub API จำกัด 60 ครั้งต่อชั่วโมงโดยนับ "ต่อหมายเลข IP" ไม่ใช่ต่อเครื่อง
 *    หน่วยบริการที่ลงหลายเครื่องออกเน็ตผ่าน IP เดียวกันจึงแชร์โควตาก้อนเดียวทั้งหน่วย
 *
 * Drive แก้ทั้งสองข้อ: ผู้ดูแลอัปไฟล์เองได้ทันทีโดยไม่ต้องพึ่งระบบ build ของใคร
 * และไม่มีเพดานแบบ 60 ครั้งต่อ IP มาบีบ
 *
 * เลขเวอร์ชันอ่านจาก "ชื่อไฟล์" ไม่ต้องมีไฟล์ทะเบียนแยกให้ต้องคอยแก้ให้ตรงกัน
 * อัปไฟล์ชื่อ ndp-kit-6908060553.zip ขึ้นโฟลเดอร์ = ปล่อยเวอร์ชันนั้นแล้ว
 */
import { compareVersion } from "./version";

/**
 * โฟลเดอร์ "Version Control" บน Google Drive ของผู้ดูแล
 *
 * ต้องแชร์เป็น "ทุกคนที่มีลิงก์ ผู้อ่าน" ไม่งั้นเครื่องหน่วยบริการอ่านไม่ได้
 * และควรใช้เก็บเฉพาะไฟล์แพ็กเกจ ไม่ปนไฟล์อื่น เพราะทุกไฟล์ในนี้ที่ชื่อมีเลข
 * สามท่อนและลงท้าย .zip จะถูกนับเป็นเวอร์ชันที่ปล่อยให้หน่วยบริการติดตั้งได้
 */
const FOLDER_ID = "1DBAV9DkMKxh0O-K_O54XgAd6JfQUYfRq";

/**
 * API key ของ Google Drive (ไม่บังคับ)
 *
 * มี key   = เรียก Drive API ซึ่งเป็นทางการ ตอบ JSON และโหลดไฟล์ผ่าน alt=media
 *            ได้โดยไม่ติดหน้ายืนยันสแกนไวรัสที่ Drive เด้งให้ไฟล์เกิน ~25 MB
 * ไม่มี key = อ่านหน้ารายการโฟลเดอร์แบบฝัง (embeddedfolderview) แทน ใช้ได้ทันที
 *            ไม่ต้องตั้งค่าอะไร แต่เป็นหน้าเว็บที่ Google ไม่ได้รับรองเป็น API
 *            ถ้าวันหนึ่งเขาเปลี่ยนโครงสร้างหน้า การอ่านรายการจะพัง
 *
 * ตั้งค่าได้ที่ตัวแปรระบบ DRIVE_API_KEY (ใส่ใน start.cmd) ควรจำกัดสิทธิ์ key ใน
 * Google Cloud Console ให้เรียกได้เฉพาะ Drive API เพราะ key ตัวนี้ติดไปกับโปรแกรม
 * ทุกเครื่อง ใครถอดออกมาก็ใช้ได้ ความเสียหายสูงสุดคือมีคนมาใช้โควตาแทนเรา
 */
const API_KEY = process.env.DRIVE_API_KEY || "";

/** ไฟล์เดียวกันอาจใหญ่หลาย MB จึงให้เวลานานกว่าการเรียก API ทั่วไป */
const LIST_TIMEOUT_MS = 20000;

export interface DriveVersion {
  /** เลขเวอร์ชันรูปแบบเดียวกับที่ใช้ทั้งโปรเจ็ค เช่น "6908060553" */
  tag: string;
  /** รหัสไฟล์บน Drive ใช้ประกอบเป็นที่อยู่ดาวน์โหลด */
  fileId: string;
  /** ชื่อไฟล์จริงบน Drive เอาไว้แสดงให้ผู้ดูแลตรวจว่าหยิบไฟล์ถูกตัว */
  fileName: string;
  /** ขนาดเป็นไบต์ 0 = ไม่ทราบ (วิธีอ่านแบบไม่มี key บอกขนาดไม่ได้) */
  sizeBytes: number;
}

/**
 * ดึงเลขเวอร์ชันออกจากชื่อไฟล์
 *
 * แบบปัจจุบันคือเลขสิบหลักที่เป็นวันเวลาที่สร้างแพ็กเกจ เช่น ndp-kit-6908060553.zip
 * ต้องเป็นสิบหลักพอดี ไม่ติดกับตัวเลขอื่น จึงจะนับเป็นเลขเวอร์ชัน
 *
 * ยังอ่านแบบเก่า (x.y.z) ได้อยู่ เพื่อให้ไฟล์ที่อัปไว้ก่อนหน้ายังใช้ได้ต่อ ไม่ต้อง
 * ไล่เปลี่ยนชื่อย้อนหลัง คืนค่าว่างเมื่ออ่านไม่ออก ซึ่งแปลว่าไฟล์นั้นไม่ใช่แพ็กเกจของเรา
 */
export function tagFromFileName(name: string): string {
  const dated = /(?<!\d)(\d{10})(?!\d)/.exec(name);
  if (dated) return dated[1];

  const legacy = /(\d+)\.(\d+)\.(\d+)/.exec(name);
  if (legacy) return `v${legacy[1]}.${legacy[2]}.${legacy[3]}`;

  return "";
}

/** เรียงจากใหม่ไปเก่า ใช้กฎเดียวกับที่ใช้ตัดสินว่ามีเวอร์ชันใหม่หรือไม่ */
function compareTagDesc(a: string, b: string): number {
  return -compareVersion(a, b);
}

/** แปลง &amp; &#39; ฯลฯ กลับเป็นตัวอักษรจริง ชื่อไฟล์จากหน้า HTML ถูก escape มา */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

/**
 * รายการเวอร์ชันทั้งหมดที่มีให้ติดตั้ง เรียงจากใหม่ไปเก่า
 *
 * ไฟล์ที่อ่านเลขเวอร์ชันจากชื่อไม่ได้จะถูกข้ามไปเงียบๆ ตั้งใจให้เป็นแบบนั้น
 * เพราะโฟลเดอร์อาจมีไฟล์อื่นปนอยู่ (เอกสาร คู่มือ) ไม่ควรทำให้ทั้งรายการพัง
 */
export async function listVersions(): Promise<DriveVersion[]> {
  const files = API_KEY ? await listViaApi() : await listViaFolderPage();

  const seen = new Set<string>();
  const out: DriveVersion[] = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.name)) continue;
    const tag = tagFromFileName(f.name);
    if (!tag) continue;
    // เวอร์ชันเดียวกันมีหลายไฟล์ (อัปซ้ำ/ชื่อต่างกัน) ให้ยึดไฟล์แรกที่เจอ
    // ไม่งั้นหน้าเลือกเวอร์ชันจะมีตัวเลือกซ้ำกันจนผู้ใช้ไม่รู้ว่าต่างกันตรงไหน
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, fileId: f.id, fileName: f.name, sizeBytes: f.size });
  }

  out.sort((a, b) => compareTagDesc(a.tag, b.tag));
  return out;
}

interface RawFile {
  id: string;
  name: string;
  size: number;
}

/** ทางการ ใช้เมื่อตั้ง DRIVE_API_KEY ไว้ */
async function listViaApi(): Promise<RawFile[]> {
  const q = `'${FOLDER_ID}' in parents and trashed = false`;
  const url =
    "https://www.googleapis.com/drive/v3/files" +
    `?q=${encodeURIComponent(q)}` +
    `&key=${encodeURIComponent(API_KEY)}` +
    "&fields=files(id,name,size)" +
    "&pageSize=200";

  const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (res.status === 403 || res.status === 401) {
    throw new Error("Google ปฏิเสธคำขอ อาจเป็นเพราะ API key ไม่ถูกต้องหรือถูกจำกัดสิทธิ์ไว้");
  }
  if (res.status === 404) {
    throw new Error("ไม่พบโฟลเดอร์เวอร์ชันบน Google Drive");
  }
  if (!res.ok) throw new Error(`Google Drive ตอบกลับรหัส ${res.status}`);

  const data: any = await res.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  return files.map((f: any) => ({
    id: String(f?.id || ""),
    name: String(f?.name || ""),
    size: parseInt(String(f?.size || "0"), 10) || 0,
  }));
}

/**
 * อ่านจากหน้ารายการโฟลเดอร์แบบฝัง ใช้เมื่อไม่ได้ตั้ง API key
 *
 * หน้านี้เบากว่าหน้าโฟลเดอร์ปกติมาก (ระดับกิโลไบต์ เทียบกับสองร้อยกว่ากิโลไบต์)
 * และรายการไฟล์อยู่ใน HTML ตรงๆ ไม่ได้ซ่อนอยู่ในก้อน JavaScript จึงอ่านได้
 * โดยไม่ต้องรันสคริปต์ แต่ย้ำว่านี่ไม่ใช่ API ที่ Google รับรอง
 */
async function listViaFolderPage(): Promise<RawFile[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(FOLDER_ID)}#list`;
  const res = await fetch(url, {
    headers: {
      // ไม่ใส่ User-Agent แบบเบราว์เซอร์ Google จะตอบหน้าเปล่ากลับมา
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Drive ตอบกลับรหัส ${res.status}`);

  const html = await res.text();

  // แต่ละไฟล์อยู่ในบล็อกที่มี id="entry-<รหัสไฟล์>" และชื่ออยู่ใน flip-entry-title
  // จับคู่แบบไม่ละโมบ (non-greedy) เพื่อไม่ให้ข้ามไปหยิบชื่อของไฟล์ถัดไป
  const out: RawFile[] = [];
  const re = /id="entry-([^"]+)"[\s\S]{0,2000}?flip-entry-title[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ id: m[1], name: decodeHtml(m[2]).trim(), size: 0 });
  }

  if (out.length === 0 && !/flip-entries/.test(html)) {
    // ไม่เจอแม้แต่โครงหน้า แปลว่าไม่ได้เจอหน้ารายการไฟล์จริง เช่นโดนพาไปหน้า
    // ให้ล็อกอิน หรือระบบกรองเว็บของหน่วยงานส่งหน้าอื่นกลับมาแทน
    throw new Error("อ่านรายการไฟล์จาก Google Drive ไม่ได้ อาจถูกระบบกรองเว็บของหน่วยงานขวางไว้");
  }

  return out;
}

/**
 * ที่อยู่สำหรับดาวน์โหลดไฟล์ของเวอร์ชันนั้น
 *
 * ผูกกับรหัสไฟล์ซึ่งไม่ซ้ำกันทุกไฟล์ จึงไม่มีปัญหาแคชระหว่างทางคืนไฟล์เวอร์ชันเก่า
 * แบบที่เคยเจอกับ URL กลางของ GitHub เมื่อ 5 ส.ค. 2569
 */
export function downloadUrl(v: DriveVersion): string {
  if (API_KEY) {
    return (
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(v.fileId)}` +
      `?alt=media&key=${encodeURIComponent(API_KEY)}`
    );
  }
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(v.fileId)}`;
}

/** ไว้ให้หน้าตั้งค่าบอกผู้ดูแลว่าตอนนี้ระบบอ่านรายการด้วยวิธีไหน */
export function usingApiKey(): boolean {
  return !!API_KEY;
}
