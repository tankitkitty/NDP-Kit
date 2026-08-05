import { selectOnly } from "../readonly";
import { tableColumns, pickCol } from "../schema";
import {
  CheckDefinition,
  CheckOutcome,
  CheckSection,
  OK_MARK,
  ROW_ALERT_KEY,
  ROW_WARN_KEY,
  unavailableOutcome,
} from "../types";

const ID = "provider";
const LIMIT = 300;

/**
 * รหัสสภาวิชาชีพที่ สปสช. กำหนดสำหรับแฟ้ม PROVIDER
 *
 * เป็นรายการปิด 8 รหัส (อ้างอิงเอกสาร "62.รหัสสภาวิชาชีพ (แฟ้ม PROVIDER)")
 * เก็บเป็น array ไม่ใช่ object ด้วยเหตุผลเดียวกับตารางรหัสแผนก คือคีย์ที่เป็นเลข
 * จำนวนเต็มจะถูก JavaScript จัดขึ้นหน้าเสมอ ทำให้ลำดับเพี้ยนเวลาไล่แสดง
 */
const COUNCILS: { code: string; name: string }[] = [
  { code: "01", name: "แพทยสภา" },
  { code: "02", name: "สภาการพยาบาล" },
  { code: "03", name: "สภาเภสัชกรรม" },
  { code: "04", name: "ทันตแพทยสภา" },
  { code: "05", name: "สภากายภาพบำบัด" },
  { code: "06", name: "สภาเทคนิคการแพทย์" },
  { code: "07", name: "สัตวแพทยสภา" },
  { code: "08", name: "สภาการแพทย์แผนไทย" },
];

const COUNCIL_NAME = new Map(COUNCILS.map((c) => [c.code, c.name]));

/**
 * ประเภทบุคลากรที่ "ต้อง" มีรหัสสภาวิชาชีพ พร้อมสภาที่ควรเป็น
 *
 * บังคับเฉพาะกลุ่มที่มีใบประกอบวิชาชีพจริง (แพทย์ ทันตแพทย์ พยาบาล เภสัชกร
 * กายภาพบำบัด เทคนิคการแพทย์ แพทย์แผนไทยที่มีใบประกอบ) — ตำแหน่งอย่าง
 * เจ้าพนักงานสาธารณสุขชุมชน นักวิชาการสาธารณสุข ทันตาภิบาล อสม. ไม่มีสภาวิชาชีพ
 * ถ้าบังคับทุกคนจะขึ้นเตือนคนที่ไม่มีทางกรอกได้ แล้วคนใช้จะเลิกเชื่อผลตรวจทั้งใบ
 *
 * ค่ารหัสอ้างจากตาราง provider_type ของ HOSxP (01 แพทย์, 02 ทันตแพทย์,
 * 03 พยาบาลวิชาชีพ, 11 เภสัชกร, 12 เวชศาสตร์ฟื้นฟู, 13 เทคนิคการแพทย์,
 * 011 แพทย์เวชศาสตร์ครอบครัว, 081/082 แพทย์แผนไทย/แพทย์พื้นบ้านที่มีใบประกอบ)
 */
const COUNCIL_OF_PROVIDER_TYPE: Record<string, string> = {
  "01": "01",
  "011": "01",
  "02": "04",
  "03": "02",
  "11": "03",
  "12": "05",
  "13": "06",
  "081": "08",
  "082": "08",
};

/**
 * ตรวจข้อมูลบุคลากร (ตาราง doctor) สำหรับแฟ้ม PROVIDER
 *
 * แสดงบุคลากรที่ยังปฏิบัติงานทั้งหมด ไม่ใช่เฉพาะแถวที่ผิด เพราะต้องเห็นว่าใครผ่าน
 * ใครไม่ผ่านในตารางเดียวกัน (แถวแดง = ต้องแก้, แถวเหลือง = รหัสสภาไม่ตรงกับวิชาชีพ
 * ให้ไปตรวจทาน)
 *
 * HOSxP แต่ละรุ่นตั้งชื่อคอลัมน์ต่างกัน จึงสำรวจคอลัมน์จริงก่อนประกอบ query
 */
const check: CheckDefinition = {
  id: ID,
  title: "ข้อมูลบุคลากรทางการแพทย์ (PROVIDER)",
  description:
    "เลขใบประกอบวิชาชีพ / เลขบัตร ปชช. / provider_type ต้องครบ และกลุ่มวิชาชีพ (แพทย์ ทันตแพทย์ พยาบาล เภสัชกร ฯลฯ) ต้องมีรหัสสภาวิชาชีพ",
  async run(): Promise<CheckOutcome> {
    try {
      const cols = await tableColumns("doctor");
      if (cols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง doctor ในฐานข้อมูลนี้", new Error("table doctor not found"));
      }

      const licenseCol = pickCol(cols, ["licenseno", "license_no"]);
      const cidCol = pickCol(cols, ["cid"]);
      const providerTypeCol = pickCol(cols, ["provider_type_code", "provider_type_id", "provider_type"]);
      const councilCol = pickCol(cols, ["council_code", "council_id", "provider_council_code"]);
      const activeCol = pickCol(cols, ["active", "doctor_active", "isuse"]);

      // คอลัมน์ไหนไม่มีในฐานนี้ก็ข้ามเงื่อนไขนั้นไป ไม่ใช่ล้มทั้งการตรวจ
      const missingCols: string[] = [];
      if (!licenseCol) missingCols.push("เลขใบประกอบวิชาชีพ (licenseno)");
      if (!cidCol) missingCols.push("เลขบัตรประชาชน (cid)");
      if (!providerTypeCol) missingCols.push("ประเภทบุคลากร (provider_type_code)");
      if (!councilCol) missingCols.push("รหัสสภาวิชาชีพ (council_code)");

      // ชื่อประเภทบุคลากรอยู่คนละตาราง มีเฉพาะบางรุ่น จึง join เท่าที่มี
      const ptCols = await tableColumns("provider_type");
      const ptNameCol = ptCols.size > 0 ? pickCol(ptCols, ["provider_type_name", "name"]) : null;
      const ptCodeCol = ptCols.size > 0 ? pickCol(ptCols, ["provider_type_code", "code"]) : null;
      const joinPt = Boolean(providerTypeCol && ptNameCol && ptCodeCol);

      const selectParts = [
        "d.code",
        "d.name",
        licenseCol ? `COALESCE(d.${licenseCol}, '') AS licenseno` : `'' AS licenseno`,
        cidCol ? `COALESCE(d.${cidCol}, '') AS cid` : `'' AS cid`,
        providerTypeCol ? `COALESCE(CAST(d.${providerTypeCol} AS CHAR), '') AS provider_type` : `'' AS provider_type`,
        councilCol ? `COALESCE(CAST(d.${councilCol} AS CHAR), '') AS council_code` : `'' AS council_code`,
        joinPt ? `COALESCE(pt.${ptNameCol}, '') AS provider_type_name` : `'' AS provider_type_name`,
      ];

      const raw: any = await selectOnly(
        `SELECT ${selectParts.join(",\n                ")}
         FROM doctor d
         ${joinPt ? `LEFT JOIN provider_type pt ON pt.${ptCodeCol} = d.${providerTypeCol}` : ""}
         ${activeCol ? `WHERE COALESCE(d.${activeCol}, 'Y') <> 'N'` : ""}
         ORDER BY d.code
         LIMIT ${LIMIT}`
      );

      const rows = raw.map((r: any) => {
        const license = String(r.licenseno || "").trim();
        const cid = String(r.cid || "").replace(/-/g, "").trim();
        // provider_type ในฐานเก็บได้ทั้ง "3" และ "03" ต้องเทียบแบบเติมศูนย์นำหน้า
        // ยกเว้นรหัสสามหลัก (011, 081) ที่เติมแล้วจะเพี้ยน
        const ptRaw = String(r.provider_type || "").trim();
        const pt = ptRaw !== "" && ptRaw.length < 2 ? ptRaw.padStart(2, "0") : ptRaw;
        const councilRaw = String(r.council_code || "").trim();
        const council = councilRaw !== "" && councilRaw.length < 2 ? councilRaw.padStart(2, "0") : councilRaw;

        const expectedCouncil = COUNCIL_OF_PROVIDER_TYPE[pt];
        const problems: string[] = [];
        let mismatch = false;

        if (licenseCol && license === "") problems.push("ไม่มีเลขใบประกอบวิชาชีพ");
        if (cidCol && cid.length !== 13) problems.push(cid === "" ? "ไม่มีเลขบัตรประชาชน" : "เลขบัตรประชาชนไม่ครบ 13 หลัก");
        if (providerTypeCol && (pt === "" || pt === "00")) problems.push("ไม่ได้ระบุประเภทบุคลากร");

        if (councilCol) {
          if (council === "") {
            // บังคับเฉพาะกลุ่มวิชาชีพที่มีสภา ตำแหน่งอื่นปล่อยว่างได้
            if (expectedCouncil) problems.push("ไม่ได้ระบุรหัสสภาวิชาชีพ (วิชาชีพนี้บังคับ)");
          } else if (!COUNCIL_NAME.has(council)) {
            problems.push("รหัสสภาวิชาชีพไม่อยู่ในรายการ 01-08");
          } else if (expectedCouncil && council !== expectedCouncil) {
            // ฟันธงว่าผิดไม่ได้ เพราะบางคนขึ้นทะเบียนหลายวิชาชีพ จึงเตือนให้ไปดูอีกที
            mismatch = true;
          } else if (!expectedCouncil && pt !== "") {
            // วิชาชีพนี้ไม่มีสภา แต่ดันกรอกรหัสสภาไว้ — มักเกิดจากกรอกรหัสประเภท
            // บุคลากรซ้ำลงช่องสภา (เช่น ทันตาภิบาล 06 ไปโผล่เป็นสภาเทคนิคการแพทย์)
            mismatch = true;
          }
        }

        return {
          code: r.code,
          name: r.name,
          licenseno: license,
          cid: r.cid,
          provider_type: pt === "" ? "" : `${pt}${r.provider_type_name ? ` ${r.provider_type_name}` : ""}`,
          council_code: council === "" ? "" : `${council}${COUNCIL_NAME.get(council) ? ` ${COUNCIL_NAME.get(council)}` : ""}`,
          verdict:
            problems.length > 0
              ? problems.join(" + ")
              : mismatch
                ? expectedCouncil
                  ? `รหัสสภาไม่ตรงกับวิชาชีพ น่าจะเป็น ${expectedCouncil} ${COUNCIL_NAME.get(expectedCouncil)}`
                  : "ประเภทบุคลากรนี้ไม่มีสภาวิชาชีพ แต่กรอกรหัสสภาไว้"
                : OK_MARK,
          [ROW_ALERT_KEY]: problems.length > 0,
          [ROW_WARN_KEY]: problems.length === 0 && mismatch,
        };
      });

      rows.sort((a: any, b: any) => {
        if (a[ROW_ALERT_KEY] !== b[ROW_ALERT_KEY]) return a[ROW_ALERT_KEY] ? -1 : 1;
        if (a[ROW_WARN_KEY] !== b[ROW_WARN_KEY]) return a[ROW_WARN_KEY] ? -1 : 1;
        return String(a.code).localeCompare(String(b.code));
      });

      const total = rows.length;
      const bad = rows.filter((r: any) => r[ROW_ALERT_KEY]).length;
      const warn = rows.filter((r: any) => r[ROW_WARN_KEY]).length;

      const sections: CheckSection[] = [];
      if (total > 0) {
        sections.push({
          title: `บุคลากรที่ยังปฏิบัติงาน (${total} คน)`,
          columns: [
            { key: "code", label: "รหัส" },
            { key: "name", label: "ชื่อ-สกุล" },
            { key: "licenseno", label: "เลขใบประกอบวิชาชีพ" },
            { key: "cid", label: "เลขบัตรประชาชน" },
            { key: "provider_type", label: "ประเภทบุคลากร" },
            { key: "council_code", label: "สภาวิชาชีพ" },
            { key: "verdict", label: "ผลตรวจ" },
          ],
          rows,
          note:
            (total >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : "") +
            (missingCols.length ? ` (ฐานนี้ไม่มีคอลัมน์: ${missingCols.join(", ")} — ข้ามเงื่อนไขนั้น)` : ""),
        });
      }

      sections.push({
        title: "รหัสสภาวิชาชีพที่ใช้ได้ (แฟ้ม PROVIDER)",
        columns: [
          { key: "code", label: "รหัส" },
          { key: "name", label: "สภาวิชาชีพ" },
          { key: "who", label: "ใช้กับประเภทบุคลากร" },
        ],
        rows: COUNCILS.map((c) => ({
          code: c.code,
          name: c.name,
          who: Object.entries(COUNCIL_OF_PROVIDER_TYPE)
            .filter(([, council]) => council === c.code)
            .map(([pt]) => pt)
            .join(", "),
        })),
      });

      // เทียบลำดับ doctor_position กับ doctor_position_std (id เดียวกันควรหมายถึงตำแหน่งเดียวกัน)
      let positionNote = "";
      let positionProblems = 0;
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
          const graded = posRows.map((r: any) => ({ ...r, [ROW_ALERT_KEY]: !r.std_name }));
          positionProblems = graded.filter((r: any) => r[ROW_ALERT_KEY]).length;
          sections.push({
            title: `เทียบ doctor_position กับ doctor_position_std (${positionProblems} รายการไม่มีคู่ std)`,
            columns: [
              { key: "id", label: "id" },
              { key: "position_name", label: "doctor_position.name" },
              { key: "std_name", label: "doctor_position_std.name (id เดียวกัน)" },
            ],
            rows: graded,
            note: "ตรวจด้วยตาว่าชื่อสองคอลัมน์หมายถึงตำแหน่งเดียวกันหรือไม่ — ถ้าเหลื่อมลำดับกัน แฟ้ม PROVIDER จะส่งรหัสตำแหน่งผิด",
          });
        } catch {
          positionNote = " (เทียบ doctor_position/doctor_position_std ไม่ได้ — โครงสร้างคอลัมน์ไม่ตรง ให้เปิดสองตารางนี้เทียบเองใน SQL Query)";
        }
      } else {
        positionNote = " (ฐานนี้ไม่มีตาราง doctor_position/doctor_position_std)";
      }

      const problemCount = bad + positionProblems;
      const warnNote = warn > 0 ? ` และมี ${warn} คนที่รหัสสภาไม่ตรงกับวิชาชีพ (แถวสีเหลือง) ควรตรวจทาน` : "";

      return {
        id: ID,
        status: problemCount === 0 ? "pass" : "issues",
        problemCount,
        summary:
          (problemCount === 0
            ? `ข้อมูลบุคลากรครบถ้วนทั้ง ${total} คน`
            : `พบ ${problemCount} รายการที่ข้อมูลบุคลากร/ตำแหน่งไม่ครบ (จากบุคลากร ${total} คน)`) +
          warnNote +
          positionNote,
        sections,
        advice:
          "แฟ้ม PROVIDER ต้องมีเลขใบประกอบวิชาชีพ เลขบัตรประชาชน 13 หลัก และประเภทบุคลากร (provider_type) ครบทุกคนที่ยังปฏิบัติงาน\n\n" +
          "รหัสสภาวิชาชีพบังคับเฉพาะกลุ่มที่มีใบประกอบวิชาชีพ ได้แก่ แพทย์ (01) ทันตแพทย์ (02) พยาบาลวิชาชีพ (03) " +
          "เภสัชกร (11) บุคลากรเวชศาสตร์ฟื้นฟู/กายภาพบำบัด (12) เทคนิคการแพทย์ (13) แพทย์เวชศาสตร์ครอบครัว (011) " +
          "และแพทย์แผนไทย/แพทย์พื้นบ้านที่มีใบประกอบวิชาชีพ (081, 082) — ตำแหน่งอื่นเช่นเจ้าพนักงานสาธารณสุขชุมชน " +
          "นักวิชาการสาธารณสุข ทันตาภิบาล อสม. ไม่มีสภาวิชาชีพ ปล่อยว่างได้ ระบบจึงไม่แจ้งเตือน\n\n" +
          `รหัสสภาที่ใช้ได้มี 8 รหัส: ${COUNCILS.map((c) => `${c.code}=${c.name}`).join(", ")}\n\n` +
          "แถวสีเหลืองคือรหัสสภาที่กรอกไว้ไม่ตรงกับประเภทบุคลากร (เช่น พยาบาลแต่ใส่ 01 แพทยสภา) " +
          "ระบบเดาจากประเภทบุคลากรเท่านั้น ถ้าคนนั้นขึ้นทะเบียนหลายวิชาชีพจริงก็ปล่อยไว้ได้\n\n" +
          "แก้ที่ HOSxP: Tools > ทะเบียนแพทย์/เจ้าหน้าที่ (ตาราง doctor) กรอกให้ครบแล้วกดตรวจซ้ำ " +
          "ส่วนตารางตำแหน่ง ให้เทียบ doctor_position กับ doctor_position_std ให้ id ตรงความหมายเดียวกัน",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบโครงสร้างตาราง doctor / provider_type / doctor_position", error);
    }
  },
};

export default check;
