import { selectOnly } from "../readonly";
import { tableExists } from "../schema";
import { CheckDefinition, CheckOutcome, CheckSection, unavailableOutcome } from "../types";

const ID = "token";

/** ถอดเวลาหมดอายุ (exp, วินาที epoch) จาก JWT — ใช้เมื่อคอลัมน์วันหมดอายุว่าง */
function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * ตรวจ token สำหรับส่งแฟ้ม 13 แฟ้ม:
 * 1) sys_var ที่ sys_name มีคำว่า token ต้องมีค่า
 * 2) nhso_token (token ล็อกอิน NHSO ของเจ้าหน้าที่) ต้องมีอย่างน้อย 1 ตัวที่ยังไม่หมดอายุ
 */
const check: CheckDefinition = {
  id: ID,
  title: "Token สำหรับส่งแฟ้ม 13 แฟ้ม",
  description: "sys_var (%token%) ต้องมีค่า และ nhso_token ต้องมี token ที่ยังไม่หมดอายุ",
  async run(): Promise<CheckOutcome> {
    try {
      const sections: CheckSection[] = [];
      let problems: string[] = [];
      let problemCount = 0;

      // 1) sys_var
      const sysRows: any = await selectOnly(
        `SELECT sys_name,
                CASE WHEN COALESCE(sys_value, '') = '' THEN '' ELSE CONCAT(LEFT(sys_value, 24), '...') END AS value_preview,
                LENGTH(COALESCE(sys_value, '')) AS value_length
         FROM sys_var
         WHERE sys_name LIKE '%token%'
         ORDER BY sys_name`
      );
      const emptySysVars = sysRows.filter((r: any) => Number(r.value_length) === 0);
      if (sysRows.length === 0) {
        problems.push("ไม่พบตัวแปร token ใน sys_var เลย (อาจยังไม่เคยตั้งค่าการส่งออก)");
        problemCount += 1;
      } else if (emptySysVars.length > 0) {
        problems.push(`sys_var มี ${emptySysVars.length} ตัวแปร token ที่ค่าว่าง`);
        problemCount += emptySysVars.length;
      }
      sections.push({
        title: "ตัวแปร token ใน sys_var",
        columns: [
          { key: "sys_name", label: "sys_name" },
          { key: "value_preview", label: "ค่า (ตัวอย่าง)" },
          { key: "value_length", label: "ความยาว" },
        ],
        rows: sysRows,
        note: sysRows.length === 0 ? "ไม่พบแถวที่ sys_name LIKE '%token%'" : undefined,
      });

      // 2) nhso_token (ถ้ามีตารางนี้)
      if (await tableExists("nhso_token")) {
        const tokenRows: any = await selectOnly(
          `SELECT cid, is_invalid, access_token_expire, COALESCE(token, '') AS token
           FROM nhso_token
           ORDER BY access_token_expire DESC
           LIMIT 20`
        );
        const now = Date.now();
        const rows = tokenRows.map((r: any) => {
          const expMs = r.access_token_expire ? new Date(r.access_token_expire).getTime() : jwtExpMs(r.token);
          const valid = r.is_invalid !== "Y" && r.token !== "" && expMs !== null && expMs > now;
          return {
            cid: r.cid,
            is_invalid: r.is_invalid,
            expire: expMs ? new Date(expMs).toLocaleString("th-TH") : "-",
            status: valid ? "ใช้ได้" : "หมดอายุ/ใช้ไม่ได้",
          };
        });
        const validCount = rows.filter((r: any) => r.status === "ใช้ได้").length;
        if (validCount === 0) {
          problems.push("ไม่มี NHSO token ที่ยังใช้ได้ — ให้เจ้าหน้าที่ล็อกอิน NHSO ใน HOSxP ใหม่");
          problemCount += 1;
        }
        sections.push({
          title: `NHSO token ของเจ้าหน้าที่ (ใช้ได้ ${validCount} จาก ${rows.length})`,
          columns: [
            { key: "cid", label: "เลขบัตรเจ้าหน้าที่" },
            { key: "is_invalid", label: "is_invalid" },
            { key: "expire", label: "หมดอายุ" },
            { key: "status", label: "สถานะ" },
          ],
          rows,
        });
      }

      return {
        id: ID,
        status: problemCount === 0 ? "pass" : "issues",
        problemCount,
        summary: problemCount === 0 ? "มี token ครบและยังไม่หมดอายุ" : problems.join(" • "),
        sections,
        advice:
          "การส่ง 13 แฟ้มเข้า NDP ต้องมี token ที่ยังไม่หมดอายุ: " +
          "(1) ตัวแปร token ใน sys_var ตั้งค่าผ่านหน้าจอตั้งค่าการส่งออกของ HOSxP " +
          "(2) NHSO token ได้จากการที่เจ้าหน้าที่ล็อกอินระบบตรวจสอบสิทธิ (Smart Card / NHSO Client) ใน HOSxP — " +
          "ถ้าหมดอายุให้ล็อกอินใหม่ ระบบจะบันทึกลง nhso_token อัตโนมัติ ไม่ควรแก้ค่า token ตรงในฐานข้อมูลเอง",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบว่าฐานนี้มีตาราง sys_var (คอลัมน์ sys_name, sys_value) หรือไม่", error);
    }
  },
};

export default check;
