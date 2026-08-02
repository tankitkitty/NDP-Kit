import { selectOnly } from "../readonly";
import { CheckDefinition, CheckContext, CheckOutcome, unavailableOutcome } from "../types";

const ID = "auth-code";
const LIMIT = 1000;

/**
 * เคสในช่วงวันที่ที่เลือกซึ่งยังไม่มีเลขปิดสิทธิ (authorization code จากการตรวจ
 * สอบสิทธิ/ปิดสิทธิกับ สปสช.) — เคสเหล่านี้ส่งเคลมไปมักถูกตีกลับหรือไม่ได้รับจ่าย
 */
const check: CheckDefinition = {
  id: ID,
  title: "เคสที่ยังไม่มีเลขปิดสิทธิ (Authorization)",
  description: "visit ในช่วงวันที่ที่เลือกที่ visit_pttype.auth_code ยังว่าง (เลือกช่วงวันที่ด้านบน)",
  needsRange: true,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    try {
      const rows: any = await selectOnly(
        `SELECT o.vn, o.hn,
                DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
                TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patient_name,
                vp.pttype,
                pt.name AS pttype_name
         FROM ovst o
         LEFT JOIN patient p ON p.hn = o.hn
         LEFT JOIN (
           SELECT vn,
                  MAX(NULLIF(TRIM(REPLACE(REPLACE(auth_code, CHAR(9), ''), CHAR(10), '')), '')) AS auth_code,
                  SUBSTRING_INDEX(GROUP_CONCAT(pttype ORDER BY pttype_number), ',', 1) AS pttype
           FROM visit_pttype
           GROUP BY vn
         ) vp ON vp.vn = o.vn
         LEFT JOIN pttype pt ON pt.pttype = vp.pttype
         WHERE o.vstdate BETWEEN ? AND ?
           AND COALESCE(vp.auth_code, '') = ''
         ORDER BY o.vstdate, o.vn
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
            ? `ทุกเคสในช่วง ${ctx.from} ถึง ${ctx.to} มีเลขปิดสิทธิแล้ว`
            : `พบ ${count} เคสที่ยังไม่มีเลขปิดสิทธิ`,
        sections:
          count === 0
            ? []
            : [
                {
                  columns: [
                    { key: "vstdate", label: "วันที่รับบริการ" },
                    { key: "vn", label: "VN" },
                    { key: "hn", label: "HN" },
                    { key: "patient_name", label: "ชื่อ-สกุล" },
                    { key: "pttype", label: "รหัสสิทธิ" },
                    { key: "pttype_name", label: "ชื่อสิทธิ" },
                  ],
                  rows,
                  note: count >= LIMIT ? `แสดง ${LIMIT} รายการแรก — ย่อช่วงวันที่เพื่อดูครบ` : undefined,
                },
              ],
        advice:
          "ก่อนส่งเคลม ทุกเคสควรผ่านการตรวจสอบสิทธิ/ปิดสิทธิกับ สปสช. จนได้เลข Authorization (บันทึกใน visit_pttype.auth_code) " +
          "และออกใบแจ้งหนี้ให้เรียบร้อย — เคสที่ไม่มีเลขปิดสิทธิมักถูกตีกลับหรือไม่ได้รับการจ่าย " +
          "วิธีแก้: ใช้หน้า 'ตรวจสอบสิทธิ' ของเครื่องมือนี้ หรือระบบตรวจสอบสิทธิใน HOSxP ปิดสิทธิย้อนหลังทีละเคส " +
          "ไม่แนะนำให้กรอก auth_code ตรงในฐานข้อมูลเองโดยไม่ผ่านการตรวจสอบจริง",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบว่าฐานนี้มีตาราง ovst / patient / visit_pttype / pttype หรือไม่", error);
    }
  },
};

export default check;
