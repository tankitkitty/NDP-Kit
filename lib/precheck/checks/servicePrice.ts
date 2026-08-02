import { selectOnly } from "../readonly";
import { CheckDefinition, CheckContext, CheckOutcome, unavailableOutcome } from "../types";

const ID = "service-price";
const LIMIT = 300;

/**
 * เทียบราคาที่คีย์จริงในรายการค่ารักษา (opitemrece.unitprice) กับราคาตั้งต้น
 * (drugitems.unitprice) ในช่วงวันที่ที่ผู้ใช้เลือก — สรุปเป็นรายรหัส (icode)
 * เพื่อไม่ให้ตารางยาวเกิน และให้เห็นว่ารหัสไหนคีย์ราคาเพี้ยนบ่อย
 */
const check: CheckDefinition = {
  id: ID,
  title: "ราคาที่คีย์จริงเทียบราคาตั้งต้น",
  description: "opitemrece.unitprice ต้องเท่ากับ drugitems.unitprice (เลือกช่วงวันที่ด้านบน)",
  needsRange: true,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    try {
      const rows: any = await selectOnly(
        `SELECT o.icode,
                d.name,
                d.unitprice AS master_price,
                o.unitprice AS keyed_price,
                COUNT(*) AS times,
                DATE_FORMAT(MIN(o.vstdate), '%Y-%m-%d') AS first_date,
                DATE_FORMAT(MAX(o.vstdate), '%Y-%m-%d') AS last_date
         FROM opitemrece o
         JOIN drugitems d ON d.icode = o.icode
         WHERE o.vstdate BETWEEN ? AND ?
           AND COALESCE(o.unitprice, 0) <> COALESCE(d.unitprice, 0)
         GROUP BY o.icode, o.unitprice
         ORDER BY times DESC
         LIMIT ${LIMIT}`,
        [ctx.from, ctx.to]
      );

      const count = rows.length;
      return {
        id: ID,
        status: count === 0 ? "pass" : "issues",
        problemCount: count,
        summary:
          count === 0
            ? `ราคาที่คีย์ในช่วง ${ctx.from} ถึง ${ctx.to} ตรงกับราคาตั้งต้นทั้งหมด`
            : `พบ ${count} กลุ่มรายการ (รหัส+ราคา) ที่คีย์ราคาไม่ตรงราคาตั้งต้น`,
        sections:
          count === 0
            ? []
            : [
                {
                  columns: [
                    { key: "icode", label: "icode" },
                    { key: "name", label: "ชื่อรายการ" },
                    { key: "master_price", label: "ราคาตั้งต้น (drugitems)" },
                    { key: "keyed_price", label: "ราคาที่คีย์ (opitemrece)" },
                    { key: "times", label: "จำนวนครั้ง" },
                    { key: "first_date", label: "พบครั้งแรก" },
                    { key: "last_date", label: "พบล่าสุด" },
                  ],
                  rows,
                  note: count >= LIMIT ? `แสดง ${LIMIT} กลุ่มแรก (เรียงตามจำนวนครั้ง)` : undefined,
                },
              ],
        advice:
          "ถ้าราคาที่คีย์จริงไม่ตรงราคาตั้งต้น ยอดเบิกที่ส่ง NDP จะไม่ตรงกับ Fee Schedule และอาจถูกตัดยอด " +
          "ก่อนแก้ให้ตรวจก่อนว่า 'ราคาตั้งต้นถูกต้อง' (ผ่านการ์ดตรวจ Drug Catalog แล้ว) " +
          "จากนั้นใช้ SQL ตัวอย่างด้านล่างปรับราคาในช่วงวันที่ที่เลือกให้ตรงราคาตั้งต้น — " +
          "ระวัง: อย่ารันกับเคสที่ออกใบเสร็จ/ส่งเคลมไปแล้ว และตาราง HOSxP เป็น MyISAM ย้อนกลับไม่ได้ ควรสำรองตารางก่อน",
        fixSql:
          `-- ปรับราคาที่คีย์ให้ตรงราคาตั้งต้น เฉพาะรหัสที่ตรวจแล้วว่าราคาตั้งต้นถูกต้อง\n` +
          `-- (เปลี่ยน icode และช่วงวันที่ตามต้องการ ก่อนรันควรสำรองตาราง opitemrece)\n` +
          `UPDATE opitemrece o\n` +
          `JOIN drugitems d ON d.icode = o.icode\n` +
          `SET o.unitprice = d.unitprice,\n` +
          `    o.sum_price = o.qty * d.unitprice\n` +
          `WHERE o.vstdate BETWEEN '${ctx.from}' AND '${ctx.to}'\n` +
          `  AND o.icode = 'ระบุ icode';`,
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบว่าตาราง opitemrece มีคอลัมน์ icode, unitprice, vstdate หรือไม่", error);
    }
  },
};

export default check;
