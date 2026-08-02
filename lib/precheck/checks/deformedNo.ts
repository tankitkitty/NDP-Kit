import { selectOnly } from "../readonly";
import { CheckDefinition, CheckOutcome, unavailableOutcome } from "../types";

const ID = "deformed-no";
const LIMIT = 500;

const ADVICE =
  "แฟ้ม PERSON/ผู้พิการ ที่ส่ง NDP จะถูกตีกลับถ้าเลขบัตรผู้พิการ (person_deformed.deformed_no) " +
  "ไม่ตรงกับเลขบัตรประชาชน 13 หลักของบุคคลนั้น (person.cid แบบไม่มีขีด) " +
  "วิธีแก้: รันคำสั่ง UPDATE ด้านล่างใน SQL Query ของ HOSxP (หรือกดปุ่มรันแก้ไขพร้อมยืนยันในหน้านี้) " +
  "ส่วนรายการที่ cid ว่าง ต้องไปเติมเลขบัตรประชาชนในทะเบียนบุคคล (person) ก่อน จึงจะแก้ deformed_no ได้";

/** UPDATE ที่ปลอดภัย: แก้เฉพาะแถวที่ cid ไม่ว่าง (กันการเซ็ต deformed_no เป็นค่าว่าง) */
export const DEFORMED_FIX_SQL = `UPDATE person_deformed pd
JOIN person p ON p.person_id = pd.person_id
SET pd.deformed_no = REPLACE(p.cid, '-', '')
WHERE COALESCE(pd.deformed_no, '') <> REPLACE(COALESCE(p.cid, ''), '-', '')
  AND COALESCE(p.cid, '') <> ''`;

export const DEFORMED_COUNT_SQL = `SELECT COUNT(*) AS cnt
FROM person_deformed pd
JOIN person p ON p.person_id = pd.person_id
WHERE COALESCE(pd.deformed_no, '') <> REPLACE(COALESCE(p.cid, ''), '-', '')
  AND COALESCE(p.cid, '') <> ''`;

const check: CheckDefinition = {
  id: ID,
  title: "เลขบัตรผู้พิการตรงกับเลขบัตรประชาชน",
  description: "person_deformed.deformed_no ต้องเท่ากับ person.cid (ตัดขีดออก)",
  async run(): Promise<CheckOutcome> {
    try {
      const rows: any = await selectOnly(
        `SELECT pd.person_id,
                p.cid,
                TRIM(CONCAT(COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS person_name,
                pd.deformed_no,
                CASE WHEN COALESCE(p.cid, '') = '' THEN 'cid ว่าง — เติมในทะเบียนบุคคลก่อน'
                     ELSE 'แก้อัตโนมัติได้' END AS fix_hint
         FROM person_deformed pd
         JOIN person p ON p.person_id = pd.person_id
         WHERE COALESCE(pd.deformed_no, '') <> REPLACE(COALESCE(p.cid, ''), '-', '')
         ORDER BY person_name
         LIMIT ${LIMIT}`
      );

      const count = rows.length;
      return {
        id: ID,
        status: count === 0 ? "pass" : "issues",
        problemCount: count,
        summary:
          count === 0
            ? "เลขบัตรผู้พิการตรงกับ cid ทุกรายการ"
            : `พบ ${count} รายการที่ deformed_no ไม่ตรงกับ cid`,
        sections:
          count === 0
            ? []
            : [
                {
                  columns: [
                    { key: "person_id", label: "person_id" },
                    { key: "person_name", label: "ชื่อ-สกุล" },
                    { key: "cid", label: "เลขบัตรประชาชน (person.cid)" },
                    { key: "deformed_no", label: "เลขบัตรผู้พิการ (deformed_no)" },
                    { key: "fix_hint", label: "แนวทาง" },
                  ],
                  rows,
                  note: count >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : undefined,
                },
              ],
        advice: ADVICE,
        fixSql: DEFORMED_FIX_SQL + ";",
        canExecuteFix: count > 0,
      };
    } catch (error) {
      return unavailableOutcome(
        ID,
        "ตรวจสอบว่าฐานนี้มีตาราง person_deformed และ person (คอลัมน์ person_id, cid, deformed_no) หรือไม่",
        error
      );
    }
  },
};

export default check;
