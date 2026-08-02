import { selectOnly } from "../readonly";
import { tableColumns, pickCol } from "../schema";
import { CheckDefinition, CheckOutcome, CheckSection, unavailableOutcome } from "../types";

const ID = "provider";
const LIMIT = 300;

/**
 * ตรวจข้อมูลบุคลากร (ตาราง doctor ใน HOSxP) สำหรับแฟ้ม PROVIDER:
 * เลขใบประกอบวิชาชีพ, เลขบัตรประชาชน 13 หลัก, ประเภทบุคลากร (provider_type),
 * รหัสสภาวิชาชีพ (01-07) ต้องไม่ว่าง
 * และเทียบตาราง doctor_position กับ doctor_position_std ว่าลำดับ id ตรงกัน
 *
 * HOSxP แต่ละรุ่นตั้งชื่อคอลัมน์ต่างกัน จึงสำรวจคอลัมน์จริงก่อนประกอบ query
 */
const check: CheckDefinition = {
  id: ID,
  title: "ข้อมูลบุคลากรทางการแพทย์ (PROVIDER)",
  description: "เลขใบประกอบวิชาชีพ / เลขบัตร ปชช. / provider_type / รหัสสภาวิชาชีพ ต้องครบ",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("doctor");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง doctor ในฐานข้อมูลนี้", new Error("table doctor not found"));
      }

      const licenseCol = pickCol(cols, ["licenseno", "license_no", "code_council"]);
      const cidCol = pickCol(cols, ["cid"]);
      const providerTypeCol = pickCol(cols, ["provider_type_id", "provider_type", "provider_type_code"]);
      const councilCol = pickCol(cols, ["council_code", "council_id", "provider_council_code"]);
      const activeCol = pickCol(cols, ["active", "doctor_active", "isuse"]);

      const missing: string[] = [];
      const conditions: string[] = [];
      const selectExtras: string[] = [];

      if (licenseCol) {
        conditions.push(`COALESCE(d.${licenseCol}, '') = ''`);
        selectExtras.push(`d.${licenseCol} AS licenseno`);
      } else missing.push("เลขใบประกอบวิชาชีพ (licenseno)");

      if (cidCol) {
        conditions.push(`(COALESCE(d.${cidCol}, '') = '' OR LENGTH(REPLACE(d.${cidCol}, '-', '')) <> 13)`);
        selectExtras.push(`d.${cidCol} AS cid`);
      } else missing.push("เลขบัตรประชาชน (cid)");

      if (providerTypeCol) {
        conditions.push(`COALESCE(CAST(d.${providerTypeCol} AS CHAR), '') IN ('', '0')`);
        selectExtras.push(`d.${providerTypeCol} AS provider_type`);
      } else missing.push("ประเภทบุคลากร (provider_type)");

      if (councilCol) {
        conditions.push(
          `(COALESCE(CAST(d.${councilCol} AS CHAR), '') = '' OR LPAD(CAST(d.${councilCol} AS CHAR), 2, '0') NOT IN ('01','02','03','04','05','06','07'))`
        );
        selectExtras.push(`d.${councilCol} AS council_code`);
      } else missing.push("รหัสสภาวิชาชีพ (council_code)");

      const sections: CheckSection[] = [];
      let problemCount = 0;

      if (conditions.length > 0) {
        const activeWhere = activeCol ? `COALESCE(d.${activeCol}, 'Y') <> 'N' AND ` : "";
        const rows: any = await selectOnly(
          `SELECT d.code, d.name${selectExtras.length ? ", " + selectExtras.join(", ") : ""}
           FROM doctor d
           WHERE ${activeWhere}(${conditions.join(" OR ")})
           ORDER BY d.code
           LIMIT ${LIMIT}`
        );
        problemCount += rows.length;
        if (rows.length > 0) {
          const columns = [
            { key: "code", label: "รหัส" },
            { key: "name", label: "ชื่อ-สกุล" },
          ];
          if (licenseCol) columns.push({ key: "licenseno", label: "เลขใบประกอบวิชาชีพ" });
          if (cidCol) columns.push({ key: "cid", label: "เลขบัตรประชาชน" });
          if (providerTypeCol) columns.push({ key: "provider_type", label: "ประเภทบุคลากร" });
          if (councilCol) columns.push({ key: "council_code", label: "รหัสสภาวิชาชีพ" });
          sections.push({
            title: "บุคลากรที่ข้อมูลไม่ครบ",
            columns,
            rows,
            note:
              (rows.length >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : "") +
              (missing.length ? ` (ฐานนี้ไม่มีคอลัมน์: ${missing.join(", ")} — ข้ามเงื่อนไขนั้น)` : ""),
          });
        }
      }

      // เทียบลำดับ doctor_position กับ doctor_position_std (id เดียวกันควรหมายถึงตำแหน่งเดียวกัน)
      let positionNote = "";
      const posCols = await tableColumns("doctor_position");
      const stdCols = await tableColumns("doctor_position_std");
      if (posCols.size > 0 && stdCols.size > 0) {
        try {
          // ชื่อคอลัมน์ต่างกันตามรุ่น: doctor_position ใช้ id/name,
          // doctor_position_std มักใช้ doctor_position_std_id/_name
          const posId = pickCol(posCols, ["id", "doctor_position_id"]);
          const posName = pickCol(posCols, ["name", "doctor_position_name"]);
          const stdId = pickCol(stdCols, ["doctor_position_std_id", "id"]);
          const stdName = pickCol(stdCols, ["doctor_position_std_name", "name"]);
          if (!posId || !posName || !stdId || !stdName) {
            throw new Error("ไม่รู้จักชื่อคอลัมน์ id/name ของตารางตำแหน่ง");
          }
          const posRows: any = await selectOnly(
            `SELECT a.${posId} AS id, a.${posName} AS position_name, s.${stdName} AS std_name
             FROM doctor_position a
             LEFT JOIN doctor_position_std s ON s.${stdId} = a.${posId}
             ORDER BY a.${posId}
             LIMIT ${LIMIT}`
          );
          const misaligned = posRows.filter((r: any) => !r.std_name);
          problemCount += misaligned.length;
          sections.push({
            title: `เทียบ doctor_position กับ doctor_position_std (${misaligned.length} รายการไม่มีคู่ std)`,
            columns: [
              { key: "id", label: "id" },
              { key: "position_name", label: "doctor_position.name" },
              { key: "std_name", label: "doctor_position_std.name (id เดียวกัน)" },
            ],
            rows: posRows,
            note: "ตรวจด้วยตาว่าชื่อสองคอลัมน์หมายถึงตำแหน่งเดียวกันหรือไม่ — ถ้าเหลื่อมลำดับกัน แฟ้ม PROVIDER จะส่งรหัสตำแหน่งผิด",
          });
        } catch {
          positionNote = " (เทียบ doctor_position/doctor_position_std ไม่ได้ — โครงสร้างคอลัมน์ไม่ตรง ให้เปิดสองตารางนี้เทียบเองใน SQL Query)";
        }
      } else {
        positionNote = " (ฐานนี้ไม่มีตาราง doctor_position/doctor_position_std)";
      }

      return {
        id: ID,
        status: problemCount === 0 ? "pass" : "issues",
        problemCount,
        summary:
          (problemCount === 0
            ? "ข้อมูลบุคลากรครบถ้วน"
            : `พบ ${problemCount} รายการที่ข้อมูลบุคลากร/ตำแหน่งไม่ครบ`) + positionNote,
        sections,
        advice:
          "แฟ้ม PROVIDER ต้องมีเลขใบประกอบวิชาชีพ เลขบัตรประชาชน 13 หลัก ประเภทบุคลากร และรหัสสภาวิชาชีพ (01=แพทยสภา, 02=ทันตแพทยสภา, 03=สภาการพยาบาล, 04=สภาเภสัชกรรม, 05=กายภาพบำบัด, 06=เทคนิคการแพทย์, 07=สภาการแพทย์แผนไทย) ครบทุกคนที่ยังปฏิบัติงาน " +
          "แก้ที่ HOSxP: Tools > ทะเบียนแพทย์/เจ้าหน้าที่ (ตาราง doctor) — กรอกให้ครบแล้วกดตรวจซ้ำ " +
          "ส่วนตารางตำแหน่ง ให้เทียบ doctor_position กับ doctor_position_std ให้ id ตรงความหมายเดียวกัน",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบโครงสร้างตาราง doctor / doctor_position / doctor_position_std", error);
    }
  },
};

export default check;
