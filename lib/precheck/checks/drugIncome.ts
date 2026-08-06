import { selectOnly } from "../readonly";
import { tableColumns } from "../schema";
import {
  CheckDefinition,
  CheckOutcome,
  ROW_ALERT_KEY,
  ROW_WARN_KEY,
  unavailableOutcome,
} from "../types";

const ID = "drug-income";
const LIMIT = 1000;

/** หมวดรายได้ที่ถูกต้องของรายการยา = ค่ายาและสารอาหารทางเส้นเลือดผู้ป่วยนอก */
const EXPECTED_INCOME = "03";

/** ย้อนหลังกี่วันถึงถือว่า "ยังใช้อยู่จริง" — ใช้เกณฑ์เดียวกับการ์ดรหัส TMT */
const ACTIVE_DAYS = 365;

/**
 * รายการยาที่ยังไม่ได้ใส่หมวดค่าบริการ หรือใส่ไว้ไม่ใช่รหัส 03
 *
 * หมวดรายได้ (drugitems.income) เป็นตัวบอกว่ารายการนั้นถูกนับเป็นค่าใช้จ่ายประเภทไหน
 * ตอนส่งเคลม ถ้ารายการยาถูกตั้งเป็นหมวดอื่น ยอดจะไปโผล่ผิดช่องในใบเบิก
 *
 * แสดงชื่อหมวดที่ตั้งไว้จริงด้วย ไม่ใช่แค่เลข เพราะเลข 04/05 เพียวๆ อ่านแล้วไม่รู้ว่า
 * ผิดตรงไหน ต้องเห็นว่าเป็น "ค่ายากลับบ้าน" หรือ "ค่าเวชภัณฑ์ที่มิใช่ยา" ถึงจะตัดสินใจ
 * ได้ว่าตั้งผิดจริง หรือตั้งใจตั้งไว้แบบนั้น (บางรายการเป็นเวชภัณฑ์ที่อยู่ในทะเบียนยา)
 */
const check: CheckDefinition = {
  id: ID,
  title: "ยาที่ยังไม่ใส่หมวดค่าบริการ หรือไม่ใช่รหัส 03",
  description: "drugitems.income ของรายการยาควรเป็น 03 (ค่ายาผู้ป่วยนอก)",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("drugitems");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง drugitems", new Error("table drugitems not found"));
      }
      if (!cols.has("income")) {
        return unavailableOutcome(
          ID,
          "ตาราง drugitems ของฐานนี้ไม่มีคอลัมน์ income",
          new Error("column income not found")
        );
      }

      // ทะเบียนหมวดรายได้มีชื่อไทยกำกับ แต่ HOSxP บางรุ่นอาจไม่มีตารางนี้ จึง join
      // เฉพาะเมื่อมีจริง ไม่งั้นทั้งการ์ดจะพังทั้งที่ข้อมูลหลักอ่านได้
      const hasIncomeTable = (await tableColumns("income")).size > 0;
      const nameExpr = hasIncomeTable ? "COALESCE(inc.name, '')" : "''";
      const joinExpr = hasIncomeTable ? "LEFT JOIN income inc ON inc.income = d.income" : "";

      const raw: any = await selectOnly(
        `SELECT d.icode,
                TRIM(CONCAT(COALESCE(d.name, ''), ' ', COALESCE(d.strength, ''), ' ', COALESCE(d.units, ''))) AS drugname,
                COALESCE(d.income, '') AS income,
                ${nameExpr} AS income_name,
                (SELECT COUNT(*) FROM opitemrece i
                  WHERE i.icode = d.icode
                    AND i.vstdate >= DATE_SUB(CURDATE(), INTERVAL ${ACTIVE_DAYS} DAY)) AS uses
           FROM drugitems d
           ${joinExpr}
          WHERE d.income IS NULL OR d.income <> ?
          ORDER BY d.icode
          LIMIT ${LIMIT}`,
        [EXPECTED_INCOME]
      );

      const rows = raw.map((r: any) => {
        const uses = Number(r.uses || 0);
        const income = String(r.income || "").trim();
        return {
          icode: r.icode,
          drugname: r.drugname,
          income: income || "(ยังไม่ได้ใส่)",
          income_name: r.income_name || (income ? "" : "-"),
          uses: uses > 0 ? `${uses} ครั้ง` : "ไม่ได้จ่ายเลย",
          // ยังจ่ายจริงอยู่ = ยอดไปโผล่ผิดช่องในใบเบิกทุกครั้งที่จ่าย ต้องรีบแก้
          [ROW_ALERT_KEY]: uses > 0,
          [ROW_WARN_KEY]: uses === 0,
        };
      });

      const total = rows.length;
      const active = rows.filter((r: any) => r[ROW_ALERT_KEY]).length;

      return {
        id: ID,
        status: total === 0 ? "pass" : active > 0 ? "issues" : "info",
        problemCount: active,
        summary:
          total === 0
            ? `รายการยาทุกตัวตั้งหมวดค่าบริการเป็น ${EXPECTED_INCOME} ครบแล้ว`
            : active > 0
              ? `พบ ${total} รายการที่หมวดค่าบริการไม่ใช่ ${EXPECTED_INCOME} — ในจำนวนนี้ ${active} รายการยังจ่ายจริงอยู่`
              : `พบ ${total} รายการที่หมวดค่าบริการไม่ใช่ ${EXPECTED_INCOME} แต่ไม่มีรายการใดถูกจ่ายในรอบ 1 ปี`,
        sections:
          total === 0
            ? []
            : [
                {
                  title: `ยาที่หมวดค่าบริการไม่ใช่ ${EXPECTED_INCOME} (${total} รายการ)`,
                  columns: [
                    { key: "icode", label: "icode" },
                    { key: "drugname", label: "ชื่อยา" },
                    { key: "income", label: "หมวดที่ตั้งไว้" },
                    { key: "income_name", label: "ชื่อหมวด" },
                    { key: "uses", label: "จ่ายใน 1 ปีที่ผ่านมา" },
                  ],
                  rows,
                  note:
                    total >= LIMIT
                      ? `แสดง ${LIMIT} รายการแรก`
                      : "แถวสีแดงคือรายการที่ยังจ่ายจริงอยู่ ต้องแก้ก่อน — แถวสีเหลืองไม่ได้จ่ายเลยในรอบ 1 ปี",
                },
              ],
        advice:
          `หมวดค่าบริการ (ช่อง income) บอกว่ารายการนั้นถูกนับเป็นค่าใช้จ่ายประเภทไหนตอนส่งเคลม ` +
          `รายการยาผู้ป่วยนอกต้องเป็นหมวด ${EXPECTED_INCOME} (ค่ายาและสารอาหารทางเส้นเลือดผู้ป่วยนอก) ` +
          `ถ้าตั้งเป็นหมวดอื่น ยอดจะไปโผล่ผิดช่องในใบเบิก\n\n` +
          "• แก้ที่ HOSxP เมนูตั้งค่า > ห้องยา > ทะเบียนยา เลือกยาแล้วเปลี่ยนหมวดค่าบริการ\n" +
          "• ตรวจทานก่อนแก้ทุกครั้ง — บางรายการในทะเบียนยาเป็นเวชภัณฑ์ที่มิใช่ยาหรือวัคซีนจริงๆ " +
          "ซึ่งตั้งเป็นหมวดอื่นถูกต้องแล้ว การ์ดนี้แสดงให้ดู ไม่ได้แปลว่าทุกแถวตั้งผิด",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบว่าฐานนี้มีตาราง drugitems และ opitemrece หรือไม่", error);
    }
  },
};

export default check;
