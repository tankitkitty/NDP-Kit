import { selectOnly } from "./precheck/readonly";
import { tableExists } from "./precheck/schema";

/**
 * สรุปภาพรวมสำหรับผู้บริหาร แสดงบนหน้าแรก
 *
 * ตอบคำถามที่ผู้บริหาร รพ.สต. ถามบ่อยที่สุด: วันนี้มีคนมากี่คน เดือนนี้เทียบเดือน
 * ที่แล้วเป็นยังไง เงินมาจากสิทธิไหนและหมวดค่าบริการอะไร
 *
 * ทุกส่วนแยก try/catch กัน ถ้าฐานของหน่วยไหนไม่มีตาราง pttype หรือ income
 * ส่วนนั้นจะว่างแต่ที่เหลือยังแสดงได้ ดีกว่าทั้งหน้าพังเพราะตารางเดียว
 */

/**
 * ทุกช่วงวันที่ยึดจาก "วันนี้" ของเครื่องเสมอ ไม่ใช้ MAX(vstdate) หาช่วงล่าสุด
 *
 * เพราะในฐานจริงมีแถวที่ vstdate เพี้ยน — พบปี 1899, 1900, 1921 และ 2563
 * (เผลอบันทึก พ.ศ. ลงในคอลัมน์วันที่) ถ้าไปยึด MAX จะได้ปี 2563 ซึ่งอยู่ไกล
 * กว่าปัจจุบัน แล้วช่วง "30 วันล่าสุด" จะเลื่อนไปคร่อมแถวเพี้ยนพวกนั้นแทน
 * การยึดวันนี้ทำให้แถวเพี้ยนหลุดออกไปเองโดยไม่ต้องเขียนเงื่อนไขกรองเพิ่ม
 */

/** จำนวนเดือนย้อนหลังในกราฟแนวโน้ม */
const TREND_MONTHS = 6;

export interface DashboardSummary {
  /** วันที่ที่ใช้เป็นฐานคำนวณ (วันนี้ตามเครื่องเซิร์ฟเวอร์) */
  today: string;
  visitsToday: number;
  peopleToday: number;

  monthLabel: string;
  visitsMonth: number;
  peopleMonth: number;
  bahtMonth: number;

  visitsPrevMonth: number;
  bahtPrevMonth: number;

  byPttype: { name: string; visits: number }[];
  byIncome: { name: string; baht: number }[];
  trend: { ym: string; visits: number; baht: number }[];

  topDiagnoses: { code: string; name: string; count: number }[];

  /**
   * ยาที่จ่ายไปแล้วเดือนนี้แต่ยังไม่ได้กำหนดรหัส TMT — เบิกไม่ได้ทั้งจำนวน
   *
   * เป็นตัวเลขที่ผู้บริหารต้องเห็น เพราะเป็นเงินที่หน่วยจ่ายออกไปจริงแล้วแต่
   * เรียกคืนไม่ได้ และแก้ได้ด้วยการตั้งรหัสในทะเบียนยาครั้งเดียว
   */
  atRiskBaht: number;
  atRiskItems: number;
  atRiskDrugs: number;
  /** ค่ายาทั้งหมดเดือนนี้ ใช้เทียบให้เห็นว่าที่เสี่ยงคิดเป็นสัดส่วนเท่าไร */
  drugBahtMonth: number;
}

function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function buildDashboard(): Promise<DashboardSummary> {
  const now = new Date();
  const today = ymd(now);
  const monthStart = firstOfMonth(now);
  const nextMonth = firstOfMonth(addMonths(now, 1));
  const prevStart = firstOfMonth(addMonths(now, -1));
  const trendStart = firstOfMonth(addMonths(now, -(TREND_MONTHS - 1)));

  const summary: DashboardSummary = {
    today,
    visitsToday: 0,
    peopleToday: 0,
    monthLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    visitsMonth: 0,
    peopleMonth: 0,
    bahtMonth: 0,
    visitsPrevMonth: 0,
    bahtPrevMonth: 0,
    byPttype: [],
    byIncome: [],
    trend: [],
    topDiagnoses: [],
    atRiskBaht: 0,
    atRiskItems: 0,
    atRiskDrugs: 0,
    drugBahtMonth: 0,
  };

  // นับ visit ด้วย vn ไม่ใช่นับแถว เพราะหนึ่งครั้งที่มารับบริการอาจมีหลายแถว
  try {
    const rows: any = await selectOnly(
      `SELECT COUNT(DISTINCT vn) visits, COUNT(DISTINCT hn) people
         FROM ovst WHERE vstdate = ?`,
      [today]
    );
    summary.visitsToday = num(rows[0]?.visits);
    summary.peopleToday = num(rows[0]?.people);
  } catch {
    // ไม่มีตาราง ovst = ยังไม่ได้ตั้งค่าฐาน ปล่อยเป็นศูนย์
  }

  try {
    const rows: any = await selectOnly(
      `SELECT COUNT(DISTINCT vn) visits, COUNT(DISTINCT hn) people
         FROM ovst WHERE vstdate >= ? AND vstdate < ?`,
      [monthStart, nextMonth]
    );
    summary.visitsMonth = num(rows[0]?.visits);
    summary.peopleMonth = num(rows[0]?.people);

    const prev: any = await selectOnly(
      `SELECT COUNT(DISTINCT vn) visits FROM ovst WHERE vstdate >= ? AND vstdate < ?`,
      [prevStart, monthStart]
    );
    summary.visitsPrevMonth = num(prev[0]?.visits);
  } catch {
    // เหมือนกัน
  }

  try {
    const rows: any = await selectOnly(
      `SELECT ROUND(SUM(sum_price), 2) total FROM opitemrece
        WHERE vstdate >= ? AND vstdate < ?`,
      [monthStart, nextMonth]
    );
    summary.bahtMonth = num(rows[0]?.total);

    const prev: any = await selectOnly(
      `SELECT ROUND(SUM(sum_price), 2) total FROM opitemrece
        WHERE vstdate >= ? AND vstdate < ?`,
      [prevStart, monthStart]
    );
    summary.bahtPrevMonth = num(prev[0]?.total);
  } catch {
    // ฐานที่ไม่มี opitemrece จะไม่มีตัวเลขเงิน แต่ยอดผู้รับบริการยังแสดงได้
  }

  // ชื่อสิทธิอยู่คนละตาราง ถ้าไม่มีให้ใช้รหัสแทนเพื่อไม่ให้ทั้งการ์ดหาย
  try {
    const hasPttype = await tableExists("pttype");
    const rows: any = hasPttype
      ? await selectOnly(
          `SELECT COALESCE(NULLIF(TRIM(t.name), ''), o.pttype) name,
                  COUNT(DISTINCT o.vn) visits
             FROM ovst o LEFT JOIN pttype t ON t.pttype = o.pttype
            WHERE o.vstdate >= ? AND o.vstdate < ?
            GROUP BY o.pttype, t.name
            ORDER BY visits DESC LIMIT 6`,
          [monthStart, nextMonth]
        )
      : await selectOnly(
          `SELECT o.pttype name, COUNT(DISTINCT o.vn) visits
             FROM ovst o WHERE o.vstdate >= ? AND o.vstdate < ?
            GROUP BY o.pttype ORDER BY visits DESC LIMIT 6`,
          [monthStart, nextMonth]
        );
    summary.byPttype = rows.map((r: any) => ({
      name: String(r.name ?? "-"),
      visits: num(r.visits),
    }));
  } catch {
    // ปล่อยว่าง
  }

  try {
    const hasIncome = await tableExists("income");
    const rows: any = hasIncome
      ? await selectOnly(
          `SELECT COALESCE(NULLIF(TRIM(n.name), ''), i.income) name,
                  ROUND(SUM(i.sum_price), 2) baht
             FROM opitemrece i LEFT JOIN income n ON n.income = i.income
            WHERE i.vstdate >= ? AND i.vstdate < ?
            GROUP BY i.income, n.name
            HAVING baht > 0
            ORDER BY baht DESC LIMIT 6`,
          [monthStart, nextMonth]
        )
      : await selectOnly(
          `SELECT i.income name, ROUND(SUM(i.sum_price), 2) baht
             FROM opitemrece i WHERE i.vstdate >= ? AND i.vstdate < ?
            GROUP BY i.income HAVING baht > 0 ORDER BY baht DESC LIMIT 6`,
          [monthStart, nextMonth]
        );
    summary.byIncome = rows.map((r: any) => ({
      name: String(r.name ?? "-"),
      baht: num(r.baht),
    }));
  } catch {
    // ปล่อยว่าง
  }

  // แนวโน้มย้อนหลัง — ดึงสองชุดแล้วประกบกันด้วยเดือน เพราะบางเดือนมีคนมาแต่ยัง
  // ไม่มีรายการค่าใช้จ่าย (หรือกลับกัน) ถ้า JOIN ในฐานจะทำให้เดือนนั้นหายไปเลย
  try {
    const visitRows: any = await selectOnly(
      `SELECT DATE_FORMAT(vstdate, '%Y-%m') ym, COUNT(DISTINCT vn) visits
         FROM ovst WHERE vstdate >= ? AND vstdate < ?
        GROUP BY ym`,
      [trendStart, nextMonth]
    );
    let bahtRows: any = [];
    try {
      bahtRows = await selectOnly(
        `SELECT DATE_FORMAT(vstdate, '%Y-%m') ym, ROUND(SUM(sum_price), 2) baht
           FROM opitemrece WHERE vstdate >= ? AND vstdate < ?
          GROUP BY ym`,
        [trendStart, nextMonth]
      );
    } catch {
      // ไม่มีตารางค่าใช้จ่ายก็ยังแสดงเส้นจำนวนผู้รับบริการได้
    }

    const visitMap = new Map<string, number>();
    for (const r of visitRows) visitMap.set(String(r.ym), num(r.visits));
    const bahtMap = new Map<string, number>();
    for (const r of bahtRows) bahtMap.set(String(r.ym), num(r.baht));

    // ไล่เดือนจากปฏิทิน ไม่ใช่จากผลลัพธ์ เดือนที่ไม่มีข้อมูลจะได้เป็นศูนย์
    // ไม่ใช่หายไปจากกราฟจนดูเหมือนเดือนนั้นไม่เคยมีอยู่
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = addMonths(now, -i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      summary.trend.push({
        ym,
        visits: visitMap.get(ym) ?? 0,
        baht: bahtMap.get(ym) ?? 0,
      });
    }
  } catch {
    // ปล่อยว่าง
  }

  // วินิจฉัยที่พบบ่อย — ต้อง JOIN ovst เพราะ ovstdiag ไม่มีวันที่ในตัวเอง
  //
  // บางรหัสในคอลัมน์นี้เป็นรหัสหัตถการ (เช่น 9357) ไม่ใช่ ICD-10 จึงหาชื่อใน
  // ตารางโรคไม่เจอ กรณีนั้นให้แสดงรหัสแทนชื่อ ดีกว่าตัดทิ้งจนผู้บริหารเห็นตัวเลข
  // ไม่ครบว่าเดือนนั้นทำอะไรไปบ้าง
  try {
    const hasIcd = await tableExists("icd101");
    const rows: any = hasIcd
      ? await selectOnly(
          `SELECT d.icd10 code, COALESCE(NULLIF(TRIM(i.name), ''), d.icd10) name, COUNT(*) n
             FROM ovstdiag d
             LEFT JOIN icd101 i ON i.code = d.icd10
             JOIN ovst o ON o.vn = d.vn
            WHERE o.vstdate >= ? AND o.vstdate < ?
            GROUP BY d.icd10, i.name ORDER BY n DESC LIMIT 10`,
          [monthStart, nextMonth]
        )
      : await selectOnly(
          `SELECT d.icd10 code, d.icd10 name, COUNT(*) n
             FROM ovstdiag d JOIN ovst o ON o.vn = d.vn
            WHERE o.vstdate >= ? AND o.vstdate < ?
            GROUP BY d.icd10 ORDER BY n DESC LIMIT 10`,
          [monthStart, nextMonth]
        );
    summary.topDiagnoses = rows.map((r: any) => ({
      code: String(r.code ?? ""),
      name: String(r.name ?? r.code ?? "-"),
      count: num(r.n),
    }));
  } catch {
    // ปล่อยว่าง
  }

  // เงินที่จ่ายยาไปแล้วแต่เบิกไม่ได้เพราะยายังไม่มีรหัส TMT
  //
  // JOIN drugitems จึงนับเฉพาะแถวที่เป็นยา ไม่ปนค่าบริการอื่น และไม่กรอง istatus
  // ต่างจากรายงานในหน้าตรวจก่อนส่งเคลม เพราะตรงนี้ถามว่า "จ่ายไปแล้วเสียเงินเท่าไร"
  // ยาที่ปิดสถานะไว้แต่ยังจ่ายอยู่ก็เสียเงินจริงเหมือนกัน
  try {
    const rows: any = await selectOnly(
      `SELECT COUNT(*) items, COUNT(DISTINCT i.icode) drugs, ROUND(SUM(i.sum_price), 2) baht
         FROM opitemrece i
         JOIN drugitems d ON d.icode = i.icode
        WHERE i.vstdate >= ? AND i.vstdate < ?
          AND (d.sks_drug_code IS NULL OR TRIM(d.sks_drug_code) = '')`,
      [monthStart, nextMonth]
    );
    summary.atRiskItems = num(rows[0]?.items);
    summary.atRiskDrugs = num(rows[0]?.drugs);
    summary.atRiskBaht = num(rows[0]?.baht);

    const all: any = await selectOnly(
      `SELECT ROUND(SUM(i.sum_price), 2) baht
         FROM opitemrece i JOIN drugitems d ON d.icode = i.icode
        WHERE i.vstdate >= ? AND i.vstdate < ?`,
      [monthStart, nextMonth]
    );
    summary.drugBahtMonth = num(all[0]?.baht);
  } catch {
    // ฐานที่ไม่มี drugitems ก็แค่ไม่แสดงการ์ดนี้
  }

  return summary;
}
