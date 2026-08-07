/**
 * รูปแบบเลขเวอร์ชันของ NDP-Kit และการเปรียบเทียบ
 *
 * ตั้งแต่ 6 ส.ค. 2569 เลิกใช้ระบบ x.y.z มาใช้ "เวลาที่สร้างแพ็กเกจ" เป็นเลขเวอร์ชันแทน
 * เป็นเลข 10 หลักติดกัน  ปีเดือนวันชั่วโมงนาที
 *
 *     6 9 0 8 0 6 0 5 5 3
 *     └┬┘ └┬┘ └┬┘ └┬┘ └┬┘
 *      │   │   │   │   └── นาที
 *      │   │   │   └────── ชั่วโมง (24 ชม.)
 *      │   │   └────────── วันที่
 *      │   └────────────── เดือน
 *      └────────────────── ปี พ.ศ. สองหลักท้าย (69 = 2569)
 *
 * ข้อดีคือไม่ต้องมานั่งตัดสินใจว่าการแก้ครั้งนี้ควรขยับหลักไหน และเห็นได้ทันทีว่า
 * เครื่องหนึ่งใช้ของที่สร้างเมื่อไร ซึ่งเป็นสิ่งที่ต้องรู้จริงๆ เวลาไล่ปัญหาที่หน่วยบริการ
 *
 * เทียบกันด้วยการเทียบตัวเลขตรงๆ เลขมากกว่า = ใหม่กว่า เพราะเรียงจากหน่วยใหญ่ไปเล็ก
 */

/** เลขเวอร์ชันแบบใหม่: สิบหลักพอดี */
const DATE_VERSION = /^\d{10}$/;

/** ตัด v นำหน้าและช่องว่างออก ให้เทียบกันได้ไม่ว่าจะเขียนมาแบบไหน */
export function normalizeVersion(v: string): string {
  return String(v || "").trim().replace(/^v/i, "");
}

/** true เมื่อเป็นเลขเวอร์ชันแบบเวลา (สิบหลัก) */
export function isDateVersion(v: string): boolean {
  return DATE_VERSION.test(normalizeVersion(v));
}

/**
 * เทียบเวอร์ชัน คืนค่าบวกเมื่อ a ใหม่กว่า b ลบเมื่อเก่ากว่า ศูนย์เมื่อเท่ากัน
 *
 * ต้องรองรับเลขแบบเก่า (2.0.26) ไปอีกพักหนึ่ง เพราะเครื่องที่ติดตั้งไปแล้วยังเป็น
 * แบบเก่าอยู่ ตอนเครื่องพวกนั้นเทียบว่ามีของใหม่ไหม จะเป็นการเทียบข้ามรูปแบบกัน
 * กฎคือ **แบบเวลาถือว่าใหม่กว่าแบบเก่าเสมอ** ซึ่งตรงกับความจริง เพราะทุกแพ็กเกจ
 * ที่ใช้เลขแบบเวลาถูกสร้างหลังจากที่เลิกใช้ x.y.z ไปแล้ว
 */
export function compareVersion(a: string, b: string): number {
  const x = normalizeVersion(a);
  const y = normalizeVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;

  const xDate = DATE_VERSION.test(x);
  const yDate = DATE_VERSION.test(y);
  if (xDate && yDate) {
    // เทียบเป็นตัวเลข ไม่ใช่ข้อความ ("0906..." กับ "6908..." ต้องเทียบค่าจริง)
    const nx = Number(x);
    const ny = Number(y);
    return nx === ny ? 0 : nx > ny ? 1 : -1;
  }
  if (xDate) return 1;
  if (yDate) return -1;

  // ทั้งคู่เป็นแบบเก่า เทียบทีละท่อนแบบตัวเลขเหมือนเดิม
  const pa = x.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = y.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const u = pa[i] ?? 0;
    const w = pb[i] ?? 0;
    if (u !== w) return u > w ? 1 : -1;
  }
  return 0;
}

/** true เมื่อ candidate ใหม่กว่า current จริงๆ เท่านั้น */
export function isNewer(candidate: string, current: string): boolean {
  if (!normalizeVersion(candidate)) return false;
  if (!normalizeVersion(current)) return true;
  return compareVersion(candidate, current) > 0;
}

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/**
 * แปลงเลขเวอร์ชันให้คนอ่านออก เช่น 6908060553 -> "6 ส.ค. 69 05:53 น."
 *
 * จำเป็นเพราะเลขสิบหลักติดกันเทียบด้วยสายตายากมาก ผู้ใช้ต้องเลือกเวอร์ชันจาก
 * รายการ ถ้าไม่แปลงให้ก็ต้องนั่งนับหลักเอง เลขแบบเก่าหรือเลขที่อ่านไม่ออกให้คืน
 * ค่าเดิมกลับไปเฉยๆ ไม่ต้องเดา
 */
export function formatVersion(v: string): string {
  const s = normalizeVersion(v);
  if (!DATE_VERSION.test(s)) return s;

  const yy = s.slice(0, 2);
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = parseInt(s.slice(4, 6), 10);
  const hh = s.slice(6, 8);
  const mi = s.slice(8, 10);
  const month = THAI_MONTHS[mm - 1];
  if (!month || !dd) return s;
  return `${dd} ${month} ${yy} ${hh}:${mi} น.`;
}

/**
 * สร้างเลขเวอร์ชันจากเวลาปัจจุบัน ใช้ตอนสร้างแพ็กเกจ
 *
 * ใช้เวลาของเครื่องที่ build ซึ่งเป็นเวลาไทยอยู่แล้ว จึงไม่ต้องแปลงเขตเวลา
 * ปี ค.ศ. บวก 543 เป็น พ.ศ. แล้วเอาสองหลักท้าย
 */
export function versionFromDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const thaiYear = d.getFullYear() + 543;
  return (
    String(thaiYear).slice(-2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}
