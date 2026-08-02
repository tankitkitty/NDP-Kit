import { selectOnly } from "../readonly";
import { tableColumns, pickCol } from "../schema";
import { CheckDefinition, CheckOutcome, CheckSection, unavailableOutcome } from "../types";

const ID = "drug-catalog";
const LIMIT = 500;

/**
 * ตรวจรหัสยา (drugitems) เทียบกับ Drug Catalog / TMT:
 * - sks_drug_code (รหัส 24 หลัก) ต้องไม่ว่าง และตรงกับรายการล่าสุดใน drug_catalog_import_detail
 * - unitprice ต้องตรงกับราคาในรายการล่าสุด (ตาม dateeffective)
 * - income (หมวดรายได้) ต้องไม่ว่าง
 * ชื่อคอลัมน์ของ drug_catalog_import_detail ต่างกันตามรุ่น จึงสำรวจก่อนประกอบ query
 */
const check: CheckDefinition = {
  id: ID,
  title: "รหัสยาเทียบ Drug Catalog / TMT",
  description: "drugitems.sks_drug_code, ราคา และหมวด income ต้องตรงกับ Drug Catalog รายการล่าสุด",
  async run(): Promise<CheckOutcome> {
    try {
      const drugCols = await tableColumns("drugitems");
      if (drugCols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง drugitems", new Error("table drugitems not found"));
      }
      const sksCol = pickCol(drugCols, ["sks_drug_code", "tmt_tp_code", "tmtid"]);
      const activeCol = pickCol(drugCols, ["istatus"]);
      const activeWhere = activeCol ? `COALESCE(d.${activeCol}, 'Y') <> 'N'` : "1=1";

      const sections: CheckSection[] = [];
      let problemCount = 0;
      const notes: string[] = [];

      // ก) เทียบกับ drug_catalog_import_detail (ถ้ามีและรู้จักคอลัมน์)
      const catCols = await tableColumns("drug_catalog_import_detail");
      if (catCols.size > 0 && sksCol) {
        const catIcode = pickCol(catCols, ["icode", "hospital_drug_code", "drug_code", "drug_catalog_hospdrugcode"]);
        // sks_drug_code คือรหัส 24 หลัก (NDC24) — ห้ามเทียบกับ TMTID (6 หลัก) เพราะจะ false ทั้งหมด
        const catTmt = pickCol(catCols, ["drug_catalog_ndc24", "ndc24", "sks_drug_code", "std_code"]);
        const catPrice = pickCol(catCols, ["price", "unit_price", "unitprice", "drug_catalog_unitprice"]);
        const catDate = pickCol(catCols, [
          "dateeffective",
          "date_effective",
          "effective_date",
          "drug_catalog_dateeffective",
          "dateupdate",
          "drug_catalog_dateupdate",
        ]);

        if (catIcode && catDate && (catTmt || catPrice)) {
          const diffConds: string[] = [`COALESCE(d.${sksCol}, '') = ''`];
          if (catTmt) diffConds.push(`COALESCE(d.${sksCol}, '') <> COALESCE(c.${catTmt}, '')`);
          if (catPrice) diffConds.push(`COALESCE(d.unitprice, 0) <> COALESCE(c.${catPrice}, 0)`);

          const rows: any = await selectOnly(
            `SELECT d.icode, d.name, d.${sksCol} AS sks_drug_code, d.unitprice, d.income
                    ${catTmt ? `, c.${catTmt} AS catalog_tmt` : ""}
                    ${catPrice ? `, c.${catPrice} AS catalog_price` : ""}
                    , c.${catDate} AS dateeffective
             FROM drugitems d
             JOIN (
               SELECT t.*
               FROM drug_catalog_import_detail t
               JOIN (
                 SELECT ${catIcode} AS icode, MAX(${catDate}) AS md
                 FROM drug_catalog_import_detail
                 GROUP BY ${catIcode}
               ) m ON m.icode = t.${catIcode} AND m.md = t.${catDate}
             ) c ON c.${catIcode} = d.icode
             WHERE ${activeWhere} AND (${diffConds.join(" OR ")})
             ORDER BY d.icode
             LIMIT ${LIMIT}`
          );
          problemCount += rows.length;
          if (rows.length > 0) {
            sections.push({
              title: "ยาที่รหัส/ราคาไม่ตรงกับ Drug Catalog รายการล่าสุด",
              columns: [
                { key: "icode", label: "icode" },
                { key: "name", label: "ชื่อยา" },
                { key: "sks_drug_code", label: "รหัสใน drugitems" },
                ...(catTmt ? [{ key: "catalog_tmt", label: "รหัสใน Catalog" }] : []),
                { key: "unitprice", label: "ราคาใน drugitems" },
                ...(catPrice ? [{ key: "catalog_price", label: "ราคาใน Catalog" }] : []),
                { key: "dateeffective", label: "วันที่มีผล (ล่าสุด)" },
              ],
              rows,
              note: rows.length >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : undefined,
            });
          }
        } else {
          notes.push(
            "รู้จักคอลัมน์ของ drug_catalog_import_detail ไม่ครบ จึงเทียบรหัส/ราคาไม่ได้ — รัน SHOW COLUMNS FROM drug_catalog_import_detail; เพื่อดูชื่อคอลัมน์จริง"
          );
        }
      } else if (!sksCol) {
        notes.push("ตาราง drugitems ไม่มีคอลัมน์ sks_drug_code — ตรวจรหัส 24 หลักไม่ได้");
      } else {
        notes.push("ฐานนี้ไม่มีตาราง drug_catalog_import_detail (ยังไม่เคยนำเข้า Drug Catalog?)");
      }

      // ข) หมวดรายได้ (income) ว่าง
      const incomeRows: any = await selectOnly(
        `SELECT d.icode, d.name, d.income, d.unitprice
         FROM drugitems d
         WHERE ${activeWhere} AND COALESCE(d.income, '') = ''
         ORDER BY d.icode
         LIMIT ${LIMIT}`
      );
      problemCount += incomeRows.length;
      if (incomeRows.length > 0) {
        sections.push({
          title: "ยาที่ไม่ได้ตั้งหมวดรายได้ (income)",
          columns: [
            { key: "icode", label: "icode" },
            { key: "name", label: "ชื่อยา" },
            { key: "income", label: "income" },
            { key: "unitprice", label: "ราคา" },
          ],
          rows: incomeRows,
          note: incomeRows.length >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : undefined,
        });
      }

      return {
        id: ID,
        status: problemCount === 0 ? "pass" : "issues",
        problemCount,
        summary:
          (problemCount === 0
            ? "รหัสยา/ราคา/หมวดรายได้ครบถ้วน"
            : `พบ ${problemCount} รายการยาที่รหัส ราคา หรือหมวดรายได้ไม่ถูกต้อง`) +
          (notes.length ? ` — ${notes.join(" • ")}` : ""),
        sections,
        advice:
          "ยาที่ส่งเบิกต้องมีรหัส 24 หลัก (sks_drug_code) ตรงกับ Drug Catalog ที่นำเข้าล่าสุด และราคา (unitprice) " +
          "ตรงกับราคาใน Catalog ตามวันที่มีผล (dateeffective) มิฉะนั้น NDP จะตัดยอดหรือตีกลับ " +
          "หมวดรายได้ (income) ต้องตั้งเป็นหมวดค่ายาที่ถูกต้องด้วย ไม่ปล่อยว่าง " +
          "วิธีแก้: นำเข้า Drug Catalog รอบล่าสุดผ่านหน้าจอ Drug Catalog ของ HOSxP แล้วกดปรับปรุงรหัส/ราคา หรือใช้ SQL ตัวอย่างด้านล่างแก้ทีละรายการ (ตรวจชื่อคอลัมน์จริงของฐานก่อนรัน)",
        fixSql:
          "-- ตัวอย่าง: ปรับรหัสและราคาให้ตรง Catalog ทีละรายการ (เปลี่ยน icode และค่าเอง)\n" +
          "UPDATE drugitems SET sks_drug_code = 'รหัส24หลัก', unitprice = 0.00 WHERE icode = 'ระบุ icode';\n" +
          "-- ตั้งหมวดรายได้ของยา (เลือกรหัสหมวดตามผังรายได้ของหน่วยบริการ)\n" +
          "UPDATE drugitems SET income = '03' WHERE icode = 'ระบุ icode';",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ตรวจสอบโครงสร้างตาราง drugitems / drug_catalog_import_detail", error);
    }
  },
};

export default check;
