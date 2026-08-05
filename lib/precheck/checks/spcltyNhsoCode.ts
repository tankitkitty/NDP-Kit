import { selectOnly } from "../readonly";
import { tableColumns, pickCol } from "../schema";
import { CheckDefinition, CheckOutcome, OK_MARK, ROW_ALERT_KEY, unavailableOutcome } from "../types";

const ID = "spclty-nhso-code";
const LIMIT = 500;

/**
 * รหัสแผนกที่ สปสช. กำหนดสำหรับฟิลด์ CLINIC
 *
 * เป็นรายการปิด ใช้ได้เฉพาะ 12 รหัสนี้เท่านั้น รหัสอื่นหรือปล่อยว่างจะไม่ผ่านการตรวจ
 * ของ NDP ทั้งชุดข้อมูล ไม่ใช่แค่แถวนั้นแถวเดียว
 *
 * เก็บชื่อไทยไว้ด้วยเพราะต้องแสดงให้ผู้ใช้เห็นว่าแผนกของตัวเองถูก map ไปเป็นอะไร
 * ถ้าบอกแค่ตัวเลขก็ตรวจทานไม่ได้ว่า map ถูกความหมายหรือเปล่า
 *
 * เก็บเป็น array ไม่ใช่ object โดยตั้งใจ เพราะถ้าดึงลำดับด้วย Object.keys จะได้
 * 10, 11, 12 ขึ้นก่อน 01 — JavaScript จัดคีย์ที่เป็นเลขจำนวนเต็มขึ้นหน้าเสมอ
 * ซึ่ง "10" เข้าข่าย แต่ "01" ไม่เข้า (มีศูนย์นำหน้า) ตารางรหัสอ้างอิงจึงเรียงมั่ว
 */
const VALID_CODES: { code: string; meaning: string }[] = [
  { code: "01", meaning: "อายุรกรรม" },
  { code: "02", meaning: "ศัลยกรรม" },
  { code: "03", meaning: "สูติกรรม" },
  { code: "04", meaning: "นรีเวชกรรม" },
  { code: "05", meaning: "กุมารเวช" },
  { code: "06", meaning: "โสตศอนาสิก" },
  { code: "07", meaning: "จักษุ" },
  { code: "08", meaning: "ศัลยกรรมกระดูก" },
  { code: "09", meaning: "จิตเวช" },
  { code: "10", meaning: "รังสีวิทยา" },
  { code: "11", meaning: "ทันตกรรม" },
  { code: "12", meaning: "อื่น ๆ" },
];

const MEANING_OF = new Map(VALID_CODES.map((v) => [v.code, v.meaning]));

const check: CheckDefinition = {
  id: ID,
  title: "รหัสแผนกของ สปสช. (spclty.nhso_code)",
  description: "แสดงการ map แผนกทั้งหมดกับรหัส สปสช. และเน้นสีแดงแถวที่รหัสไม่ใช่ 01-12",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("spclty");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง spclty ในฐานข้อมูลนี้", new Error("table spclty not found"));
      }

      const nhsoCol = pickCol(cols, ["nhso_code", "nhso_spclty_code", "provis_code"]);
      if (!nhsoCol) {
        return unavailableOutcome(
          ID,
          "ตาราง spclty ของฐานนี้ไม่มีคอลัมน์ nhso_code ให้ตรวจ",
          new Error("column nhso_code not found")
        );
      }

      // ชื่อคอลัมน์รหัสแผนกกับชื่อแผนกต่างกันได้ตามรุ่น HOSxP จึงเลือกเท่าที่มีจริง
      const codeCol = pickCol(cols, ["spclty", "spclty_code", "code"]);
      const nameCol = pickCol(cols, ["name", "spclty_name", "department"]);
      // แผนกที่ปิดใช้งานแล้วไม่ต้องบังคับ เพราะไม่มีทางถูกส่งออกไปกับชุดข้อมูล
      const activeCol = pickCol(cols, ["isuse", "active", "spclty_active"]);

      const selectParts = [
        codeCol ? `sp.${codeCol} AS spclty_code` : `'' AS spclty_code`,
        nameCol ? `sp.${nameCol} AS spclty_name` : `'' AS spclty_name`,
        `COALESCE(sp.${nhsoCol}, '') AS nhso_code`,
      ];

      // ดึงมาทั้งหมด ไม่กรองเฉพาะแถวที่ผิด เพราะต้องเห็นภาพรวมการ map ทั้งชุด
      // ว่าแผนกไหนถูก map ไปเป็นอะไร ไม่ใช่เห็นแต่แถวที่มีปัญหา
      const where = activeCol ? `WHERE COALESCE(sp.${activeCol}, 'Y') <> 'N'` : "";

      const raw: any = await selectOnly(
        `SELECT ${selectParts.join(",\n                ")}
         FROM spclty sp
         ${where}
         ORDER BY ${codeCol ? `sp.${codeCol}` : "1"}
         LIMIT ${LIMIT}`
      );

      // ตัดสินถูก/ผิดฝั่ง JS ไม่ใช่ใน SQL เพื่อไม่ต้องส่งข้อความไทยเข้าไปเป็น literal
      // ซึ่งผลลัพธ์จะขึ้นกับ charset ของ connection โดยไม่จำเป็น
      const rows = raw.map((r: any) => {
        const code = String(r.nhso_code || "").trim();
        const meaning = MEANING_OF.get(code);
        return {
          spclty_code: r.spclty_code,
          spclty_name: r.spclty_name,
          nhso_code: code,
          nhso_meaning: meaning || "",
          verdict: meaning ? OK_MARK : code ? "รหัสไม่อยู่ในรายการ 01-12" : "ยังไม่ได้กำหนดรหัส",
          [ROW_ALERT_KEY]: !meaning,
        };
      });

      // แถวที่ต้องแก้ขึ้นก่อน เพราะตารางเลื่อนดูในกรอบสูง 360px ถ้าปนอยู่กลางรายการ
      // ยาวๆ ผู้ใช้อาจไม่เลื่อนไปเจอ
      rows.sort((a: any, b: any) => {
        if (a[ROW_ALERT_KEY] !== b[ROW_ALERT_KEY]) return a[ROW_ALERT_KEY] ? -1 : 1;
        return String(a.spclty_code).localeCompare(String(b.spclty_code));
      });

      const total = rows.length;
      const bad = rows.filter((r: any) => r[ROW_ALERT_KEY]).length;

      return {
        id: ID,
        status: bad === 0 ? "pass" : "issues",
        problemCount: bad,
        summary:
          bad === 0
            ? `แผนกทั้งหมด ${total} แผนกผูกรหัส สปสช. ถูกต้องแล้ว`
            : `พบ ${bad} จาก ${total} แผนกที่รหัส สปสช. ไม่ถูกต้อง (แถวสีแดง)`,
        sections: [
          {
            title: `การ map แผนกกับรหัส สปสช. (${total} แผนก)`,
            columns: [
              { key: "spclty_code", label: "รหัสแผนกใน HOSxP" },
              { key: "spclty_name", label: "ชื่อแผนก" },
              { key: "nhso_code", label: "รหัส สปสช." },
              { key: "nhso_meaning", label: "แผนกตามรหัส สปสช." },
              { key: "verdict", label: "ผลตรวจ" },
            ],
            rows,
            note:
              total >= LIMIT
                ? `แสดง ${LIMIT} รายการแรก`
                : bad > 0
                  ? "แถวสีแดงคือแถวที่ต้องแก้"
                  : undefined,
          },
          {
            title: "รหัสที่ใช้ได้ (ใช้ได้เฉพาะ 12 รหัสนี้เท่านั้น)",
            columns: [
              { key: "code", label: "รหัส" },
              { key: "meaning", label: "แผนก" },
            ],
            rows: VALID_CODES.map((v) => ({ code: v.code, meaning: v.meaning })),
          },
        ],
        advice:
          "ฟิลด์ CLINIC ในชุดข้อมูลที่ส่ง NDP รับได้เฉพาะรหัส 01-12 ตามที่ สปสช. กำหนดเท่านั้น " +
          "แผนกที่ยังไม่ได้ผูกรหัสหรือผูกรหัสนอกรายการจะทำให้ข้อมูลของแผนกนั้นไม่ผ่านการตรวจ — " +
          "แก้ได้ที่ HOSxP เมนูตั้งค่า > ข้อมูลพื้นฐาน > แผนก โดยเลือกรหัส สปสช. ให้ตรงกับลักษณะงานของแผนก " +
          "แผนกที่ไม่เข้าพวกไหนเลยให้ใช้ 12 (อื่น ๆ) หรือใช้ SQL ด้านล่างแก้ทีละแผนก " +
          "นอกจากดูแถวสีแดงแล้ว ควรไล่ดูแถวที่เหลือด้วยว่ารหัสที่ผูกไว้ตรงกับลักษณะงานจริงของแผนกหรือไม่ " +
          "เพราะรหัสที่อยู่ในรายการแต่ map ผิดความหมาย ระบบตรวจให้ไม่ได้",
        fixSql:
          `-- รหัสที่ใช้ได้: ${VALID_CODES.map((v) => `${v.code}=${v.meaning}`).join(", ")}\n` +
          `UPDATE spclty SET ${nhsoCol} = '01' WHERE ${codeCol || "spclty"} = 'ระบุรหัสแผนก';`,
      };
    } catch (error) {
      return unavailableOutcome(
        ID,
        "ตรวจสอบว่าตาราง spclty มีคอลัมน์ nhso_code หรือไม่ (บางรุ่นใช้ชื่ออื่น)",
        error
      );
    }
  },
};

export default check;
