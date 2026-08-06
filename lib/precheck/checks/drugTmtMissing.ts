import { selectOnly } from "../readonly";
import { tableColumns } from "../schema";
import {
  CheckDefinition,
  CheckOutcome,
  ROW_ALERT_KEY,
  ROW_WARN_KEY,
  unavailableOutcome,
} from "../types";

const ID = "drug-tmt-missing";
const LIMIT = 1000;

/** ย้อนหลังกี่วันถึงถือว่า "ยังใช้อยู่จริง" — หนึ่งปีครอบคลุมยาที่จ่ายตามฤดูกาลด้วย */
const ACTIVE_DAYS = 365;

/**
 * รายการยาที่ยังไม่ได้กำหนดรหัส TMT (สกส.)
 *
 * ยาที่ไม่มีรหัสนี้จะส่งออกไป NDP ไม่ได้ เบิกไม่ได้ทั้งที่จ่ายยาไปจริง และต้องไปตั้ง
 * ในทะเบียนยาของ HOSxP ครั้งเดียวก็ใช้ได้ตลอด จึงอยู่ในกลุ่ม "ข้อมูลตั้งต้น"
 *
 * ต้องตรวจทั้ง NULL และข้อความว่าง — ในฐานจริงพบว่ามีทั้งสองแบบปนกัน (NULL 82
 * รายการ ว่าง 35 รายการ) ถ้าดูแค่ IS NULL จะมองไม่เห็นอีก 35 รายการเลย
 *
 * แยกสีตามการใช้งานจริง เพราะทะเบียนยาของหน่วยบริการมักมียาเก่าที่เลิกใช้ไปแล้ว
 * ค้างอยู่จำนวนมาก ถ้าทำเป็นสีแดงทั้งหมดผู้ใช้จะเจอรายการยาวเป็นร้อยโดยไม่รู้ว่า
 * ตัวไหนต้องรีบแก้ ตัวไหนปล่อยได้
 */
const check: CheckDefinition = {
  id: ID,
  title: "ยาที่ยังไม่ได้กำหนดรหัส TMT (สกส.)",
  description: "drugitems.sks_drug_code ต้องมีค่า ไม่งั้นส่งออกไป NDP ไม่ได้",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("drugitems");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง drugitems", new Error("table drugitems not found"));
      }
      if (!cols.has("sks_drug_code")) {
        return unavailableOutcome(
          ID,
          "ตาราง drugitems ของฐานนี้ไม่มีคอลัมน์ sks_drug_code",
          new Error("column sks_drug_code not found")
        );
      }

      const raw: any = await selectOnly(
        `SELECT d.icode,
                TRIM(CONCAT(COALESCE(d.name, ''), ' ', COALESCE(d.strength, ''), ' ', COALESCE(d.units, ''))) AS drugname,
                (SELECT COUNT(*) FROM opitemrece i
                  WHERE i.icode = d.icode
                    AND i.vstdate >= DATE_SUB(CURDATE(), INTERVAL ${ACTIVE_DAYS} DAY)) AS uses
           FROM drugitems d
          WHERE d.sks_drug_code IS NULL OR TRIM(d.sks_drug_code) = ''
          ORDER BY d.icode
          LIMIT ${LIMIT}`
      );

      const rows = raw.map((r: any) => {
        const uses = Number(r.uses || 0);
        return {
          icode: r.icode,
          drugname: r.drugname,
          uses: uses > 0 ? `${uses} ครั้ง` : "ไม่ได้จ่ายเลย",
          // จ่ายจริงอยู่ = เสียโอกาสเบิกทุกครั้งที่จ่าย ต้องรีบตั้งรหัส
          [ROW_ALERT_KEY]: uses > 0,
          // ไม่ได้จ่ายเลยในหนึ่งปี = น่าจะเป็นยาที่เลิกใช้แล้ว ตรวจทานแล้วข้ามได้
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
            ? "ยาทุกรายการกำหนดรหัส TMT (สกส.) ครบแล้ว"
            : active > 0
              ? `พบ ${total} รายการที่ยังไม่ได้กำหนดรหัส TMT — ในจำนวนนี้ ${active} รายการยังจ่ายจริงอยู่ ต้องรีบตั้งรหัส`
              : `พบ ${total} รายการที่ยังไม่ได้กำหนดรหัส TMT แต่ไม่มีรายการใดถูกจ่ายในรอบ 1 ปี (น่าจะเป็นยาที่เลิกใช้แล้ว)`,
        sections:
          total === 0
            ? []
            : [
                {
                  title: `ยาที่ยังไม่ได้กำหนดรหัส TMT (${total} รายการ)`,
                  columns: [
                    { key: "icode", label: "icode" },
                    { key: "drugname", label: "ชื่อยา" },
                    { key: "uses", label: "จ่ายใน 1 ปีที่ผ่านมา" },
                  ],
                  rows,
                  note:
                    total >= LIMIT
                      ? `แสดง ${LIMIT} รายการแรก`
                      : "แถวสีแดงคือยาที่ยังจ่ายจริงอยู่ ต้องตั้งรหัสก่อน — แถวสีเหลืองไม่ได้จ่ายเลยในรอบ 1 ปี น่าจะเป็นยาเก่าที่เลิกใช้แล้ว",
                },
              ],
        advice:
          "รหัส TMT (ช่อง sks_drug_code) คือรหัสยามาตรฐานที่ HOSxP ใช้ส่งออกไป NDP " +
          "ยาที่ไม่มีรหัสนี้จะส่งเบิกไม่ได้เลย ทั้งที่จ่ายยาให้ผู้ป่วยไปจริงแล้ว\n\n" +
          "• ตั้งที่ HOSxP เมนูตั้งค่า > ห้องยา > ทะเบียนยา เลือกยาที่ต้องการ แล้วใส่รหัส TMT ในช่องรหัสยามาตรฐาน\n" +
          "• ตั้งครั้งเดียวใช้ได้ตลอด ไม่ต้องตั้งใหม่ทุกรอบส่งเคลม\n" +
          "• ยาที่เลิกใช้แล้ว (แถวสีเหลือง) ไม่จำเป็นต้องตั้งรหัสย้อนหลัง แต่ถ้าจะกลับมาใช้อีกต้องตั้งก่อน\n\n" +
          "หมายเหตุ: ตรวจทั้งช่องที่เป็นค่าว่างและที่ยังไม่เคยกรอก เพราะในฐานจริงพบทั้งสองแบบปนกัน",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบว่าฐานนี้มีตาราง drugitems และ opitemrece หรือไม่", error);
    }
  },
};

export default check;
