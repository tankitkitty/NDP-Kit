import { BuiltinReport } from "./types";

/**
 * จำนวนผู้มารับบริการแยกตามวัน
 *
 * ใบตัวอย่างที่ใช้เป็นแบบให้ดูว่ารายงานติดโปรแกรมหน้าตาเป็นยังไง และเป็นรายงาน
 * ที่หน่วยบริการถามหาบ่อยที่สุด จึงเก็บไว้เป็นใบจริงไม่ใช่แค่ตัวอย่างในฟอร์ม
 */
const report: BuiltinReport = {
  id: "daily-visits",
  name: "ผู้มารับบริการรายวัน",
  group: "งานบริการทั่วไป",
  description: "จำนวนครั้งและจำนวนคนที่มารับบริการ แยกตามวัน ในช่วงวันที่ที่เลือก",
  // ชื่อคอลัมน์ภาษาไทยต้องอยู่ใน backtick เสมอ MariaDB ที่หน่วยบริการใช้
  // ไม่รับชื่อภาษาไทยแบบไม่ครอบ จะฟ้อง syntax error ทันที
  sql: `SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS \`วันที่\`,
       COUNT(*) AS \`จำนวนครั้ง\`,
       COUNT(DISTINCT o.hn) AS \`จำนวนคน\`
  FROM ovst o
 WHERE o.vstdate BETWEEN :from AND :to
 GROUP BY o.vstdate
 ORDER BY o.vstdate`,
  params: [
    { name: "from", label: "ตั้งแต่วันที่", type: "date", defaultValue: "" },
    { name: "to", label: "ถึงวันที่", type: "date", defaultValue: "" },
  ],
};

export default report;
