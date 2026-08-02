import { selectOnly } from "../readonly";
import { CheckDefinition, CheckOutcome, unavailableOutcome } from "../types";

const ID = "po-code";
const LIMIT = 500;

const check: CheckDefinition = {
  id: ID,
  title: "รหัสไปรษณีย์ผู้ป่วยครบ 5 หลัก",
  description: "patient.po_code ที่ไม่ว่างต้องเป็นตัวเลข 5 หลักพอดี",
  async run(): Promise<CheckOutcome> {
    try {
      const rows: any = await selectOnly(
        `SELECT hn,
                cid,
                TRIM(CONCAT(COALESCE(pname, ''), COALESCE(fname, ''), ' ', COALESCE(lname, ''))) AS patient_name,
                po_code,
                CONCAT(COALESCE(addrpart, ''), ' ม.', COALESCE(moopart, ''), ' ต.', COALESCE(tmbpart, ''),
                       ' อ.', COALESCE(amppart, ''), ' จ.', COALESCE(chwpart, '')) AS address
         FROM patient
         WHERE COALESCE(po_code, '') <> ''
           AND (LENGTH(po_code) <> 5 OR po_code REGEXP '[^0-9]')
         ORDER BY hn
         LIMIT ${LIMIT}`
      );

      const count = rows.length;
      return {
        id: ID,
        status: count === 0 ? "pass" : "issues",
        problemCount: count,
        summary:
          count === 0
            ? "รหัสไปรษณีย์ที่กรอกไว้ถูกต้องทุกรายการ"
            : `พบ ${count} รายการที่ po_code ไม่ใช่ตัวเลข 5 หลัก`,
        sections:
          count === 0
            ? []
            : [
                {
                  columns: [
                    { key: "hn", label: "HN" },
                    { key: "patient_name", label: "ชื่อ-สกุล" },
                    { key: "cid", label: "เลขบัตรประชาชน" },
                    { key: "po_code", label: "รหัสไปรษณีย์ที่กรอก" },
                    { key: "address", label: "ที่อยู่ (ช่วยหารหัสที่ถูก)" },
                  ],
                  rows,
                  note: count >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : undefined,
                },
              ],
        advice:
          "แฟ้ม ADDRESS ที่รหัสไปรษณีย์ไม่ครบ 5 หลักจะไม่ผ่านการตรวจของ NDP " +
          "รหัสไปรษณีย์ที่ถูกต้องขึ้นกับตำบล/อำเภอของผู้ป่วยแต่ละราย จึงแก้อัตโนมัติแบบเหมารวมไม่ได้ — " +
          "ให้แก้ในหน้าเวชระเบียนของ HOSxP หรือใช้ SQL ตัวอย่างด้านล่างแก้ทีละราย (เปลี่ยน HN และรหัสไปรษณีย์เอง)",
        fixSql: "UPDATE patient SET po_code = '00000' WHERE hn = 'ระบุ HN';",
      };
    } catch (error) {
      return unavailableOutcome(
        ID,
        "ตรวจสอบว่าตาราง patient มีคอลัมน์ po_code, addrpart, moopart, tmbpart, amppart, chwpart หรือไม่",
        error
      );
    }
  },
};

export default check;
