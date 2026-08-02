import { selectOnly } from "../readonly";
import { tableColumns, pickCol } from "../schema";
import { CheckDefinition, CheckOutcome, unavailableOutcome } from "../types";

const ID = "pttype-config";

/**
 * ตรวจการตั้งค่าสิทธิการรักษา (ตาราง pttype) สำหรับสิทธิที่ส่งเบิก eClaim/NDP:
 * noexpire='Y', export_eclaim='Y', is_pttype_plan='Y', default_request_funds='Y',
 * paidst='02' และ pttype_price_group_id ต้องตั้งกลุ่ม (1=เบิกได้ OFC/LGO, 2=UC/WEL)
 */
const check: CheckDefinition = {
  id: ID,
  title: "การตั้งค่าสิทธิการรักษา (pttype)",
  description: "สิทธิที่ส่งเบิกต้องตั้ง noexpire / export_eclaim / is_pttype_plan / default_request_funds / paidst / price group ครบ",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("pttype");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง pttype", new Error("table pttype not found"));
      }

      // คอลัมน์ธง — บางรุ่นไม่มีบางตัว ให้ข้ามเงื่อนไขที่ไม่มีและแจ้งไว้ในหมายเหตุ
      const flagChecks: { col: string; expect: string; label: string }[] = [];
      const addFlag = (col: string, expect: string, label: string) => {
        if (cols.has(col)) flagChecks.push({ col, expect, label });
      };
      addFlag("noexpire", "Y", "noexpire");
      addFlag("export_eclaim", "Y", "export_eclaim");
      addFlag("is_pttype_plan", "Y", "is_pttype_plan");
      addFlag("default_request_funds", "Y", "default_request_funds");
      addFlag("paidst", "02", "paidst");

      const priceGroupCol = pickCol(cols, ["pttype_price_group_id"]);
      const useCol = pickCol(cols, ["isuse", "pttype_active"]);
      const nhsoCol = pickCol(cols, ["nhso_code", "hipdata_code"]);

      const flagConds = flagChecks.map((f) => `COALESCE(pt.${f.col}, '') <> '${f.expect}'`);
      if (priceGroupCol) flagConds.push(`COALESCE(pt.${priceGroupCol}, 0) NOT IN (1, 2)`);
      if (flagConds.length === 0) {
        return unavailableOutcome(ID, "ตาราง pttype ของฐานนี้ไม่มีคอลัมน์ธงที่ใช้ตรวจเลย", new Error("no known flag columns"));
      }

      const selectCols = [
        "pt.pttype",
        "pt.name",
        ...(nhsoCol ? [`pt.${nhsoCol} AS nhso_code`] : []),
        ...flagChecks.map((f) => `pt.${f.col}`),
        ...(priceGroupCol ? [`pt.${priceGroupCol} AS pttype_price_group_id`] : []),
      ];

      // ตรวจเฉพาะสิทธิที่เปิดใช้และตั้งใจส่งเบิก (export_eclaim='Y') — สิทธิอื่นแสดงเป็นรายการให้ทบทวน
      const useWhere = useCol ? `COALESCE(pt.${useCol}, 'Y') <> 'N'` : "1=1";
      const claimWhere = cols.has("export_eclaim") ? `COALESCE(pt.export_eclaim, '') = 'Y'` : "1=1";

      const badRows: any = await selectOnly(
        `SELECT ${selectCols.join(", ")}
         FROM pttype pt
         WHERE ${useWhere} AND ${claimWhere} AND (${flagConds.join(" OR ")})
         ORDER BY pt.pttype`
      );

      const notExported: any = cols.has("export_eclaim")
        ? await selectOnly(
            `SELECT ${selectCols.join(", ")}
             FROM pttype pt
             WHERE ${useWhere} AND COALESCE(pt.export_eclaim, '') <> 'Y'
             ORDER BY pt.pttype`
          )
        : [];

      const columns = [
        { key: "pttype", label: "รหัสสิทธิ" },
        { key: "name", label: "ชื่อสิทธิ" },
        ...(nhsoCol ? [{ key: "nhso_code", label: "รหัส สปสช." }] : []),
        ...flagChecks.map((f) => ({ key: f.col, label: f.label })),
        ...(priceGroupCol ? [{ key: "pttype_price_group_id", label: "price group (1=OFC/LGO, 2=UC/WEL)" }] : []),
      ];

      const sections = [];
      if (badRows.length > 0) {
        sections.push({
          title: "สิทธิที่ส่งเบิกแต่ตั้งค่าไม่ครบ",
          columns,
          rows: badRows,
        });
      }
      if (notExported.length > 0) {
        sections.push({
          title: "สิทธิที่เปิดใช้แต่ไม่ได้ตั้ง export_eclaim='Y' (ทบทวนว่าตั้งใจไม่ส่งเบิกหรือไม่)",
          columns,
          rows: notExported,
        });
      }

      return {
        id: ID,
        status: badRows.length === 0 ? "pass" : "issues",
        problemCount: badRows.length,
        summary:
          badRows.length === 0
            ? `สิทธิที่ส่งเบิกตั้งค่าครบทุกตัว${notExported.length ? ` (มี ${notExported.length} สิทธิที่ไม่ได้ตั้งส่งเบิก — ทบทวนในรายละเอียด)` : ""}`
            : `พบ ${badRows.length} สิทธิที่ตั้งค่าไม่ครบสำหรับการส่งเบิก`,
        sections,
        advice:
          "สิทธิที่จะส่งเบิกผ่าน eClaim/NDP ต้องตั้ง noexpire='Y' (ไม่หมดอายุ), export_eclaim='Y' (ส่งออก eClaim), " +
          "is_pttype_plan='Y', default_request_funds='Y', paidst='02' (สถานะชำระเงินสำหรับส่งเบิก) " +
          "และ pttype_price_group_id ให้ตรงกลุ่ม: 1 = สิทธิเบิกได้ ข้าราชการ/อปท. (OFC/LGO), 2 = บัตรทอง/ผู้พิการ (UC/WEL) — " +
          "การเลือกกลุ่มขึ้นกับประเภทสิทธิ จึงต้องแก้ทีละสิทธิด้วย SQL ตัวอย่างด้านล่าง (เปลี่ยนรหัสสิทธิและเลขกลุ่มเอง) " +
          "หรือแก้ผ่านหน้าจอ System Setting > สิทธิการรักษา ใน HOSxP",
        fixSql:
          "UPDATE pttype SET noexpire='Y', export_eclaim='Y', is_pttype_plan='Y', default_request_funds='Y', paidst='02',\n" +
          "  pttype_price_group_id = 2  -- 1=เบิกได้ OFC/LGO, 2=UC/WEL (เลือกให้ตรงประเภทสิทธิ)\n" +
          "WHERE pttype = 'XX';  -- เปลี่ยนเป็นรหัสสิทธิที่ต้องการ",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบโครงสร้างตาราง pttype ของฐานนี้", error);
    }
  },
};

export default check;
