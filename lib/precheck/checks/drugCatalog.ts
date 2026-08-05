import { selectOnly } from "../readonly";
import { tableColumns } from "../schema";
import {
  CheckDefinition,
  CheckOutcome,
  CheckSection,
  OK_MARK,
  ROW_ALERT_KEY,
  unavailableOutcome,
} from "../types";

const ID = "drug-catalog";
const LIMIT = 1000;

/**
 * เทียบรหัส TMT และราคาของยาในคลัง (drugitems) กับ Drug Catalog ที่นำเข้าล่าสุด
 *
 * ฝั่ง drugitems ใช้ช่อง sks_drug_code เท่านั้น เพราะเป็นช่องที่ HOSxP ส่งออกไป NDP จริง
 * ส่วนฝั่ง catalog เทียบกับ drug_catalog_tmtid (ไม่ใช่ drug_catalog_ndc24 — ในฐานจริง
 * ช่อง ndc24 ว่างเปล่าทั้งตาราง ถ้าไปเทียบกับช่องนั้นจะขึ้นว่าผิดทั้งหมดโดยไม่มีมูล)
 *
 * การเลือก "รายการล่าสุด" ใช้ subquery จัดกลุ่มตาม hospdrugcode + dateeffective
 * ตามที่ผู้ดูแลระบบใช้ตรวจเองอยู่แล้ว วิธีนี้พึ่งพฤติกรรมของ MariaDB ที่ยอมให้เลือก
 * คอลัมน์นอก GROUP BY ได้ ถ้าฐานไหนเปิด ONLY_FULL_GROUP_BY ไว้ query จะไม่ผ่าน
 * แล้วการ์ดจะขึ้นว่าตรวจไม่ได้พร้อมสาเหตุ แทนที่จะให้ผลผิดเงียบๆ
 */
const check: CheckDefinition = {
  id: ID,
  title: "รหัสยาเทียบ Drug Catalog / TMT",
  description: "drugitems.sks_drug_code และราคา ต้องตรงกับ TMT/ราคาใน Drug Catalog รายการล่าสุด",
  async run(): Promise<CheckOutcome> {
    try {
      const drugCols = await tableColumns("drugitems");
      if (drugCols.size === 0) {
        return unavailableOutcome(ID, "ไม่พบตาราง drugitems", new Error("table drugitems not found"));
      }
      if (!drugCols.has("sks_drug_code")) {
        return unavailableOutcome(
          ID,
          "ตาราง drugitems ของฐานนี้ไม่มีคอลัมน์ sks_drug_code จึงเทียบรหัส TMT ไม่ได้",
          new Error("column sks_drug_code not found")
        );
      }

      const catCols = await tableColumns("drug_catalog_import_detail");
      if (catCols.size === 0) {
        return unavailableOutcome(
          ID,
          "ฐานนี้ไม่มีตาราง drug_catalog_import_detail — ยังไม่เคยนำเข้า Drug Catalog ให้นำเข้าก่อนแล้วค่อยตรวจ",
          new Error("table drug_catalog_import_detail not found")
        );
      }

      const activeWhere = drugCols.has("istatus") ? "COALESCE(d.istatus, 'Y') <> 'N' AND " : "";

      const rows: any = await selectOnly(
        `SELECT d.icode,
                d.name,
                COALESCE(d.sks_drug_code, '') AS sks_drug_code,
                COALESCE(c.tmtid, '') AS tmtid,
                d.unitprice AS drugitem_price,
                c.unitprice AS drugcat_price,
                c.dateeffective
         FROM drugitems d
         INNER JOIN (
           SELECT t.hospdrugcode, t.tmtid, t.unitprice, t.dateeffective
           FROM (
             SELECT drug_catalog_hospdrugcode AS hospdrugcode,
                    drug_catalog_tmtid AS tmtid,
                    drug_catalog_unitprice AS unitprice,
                    DATE(drug_catalog_dateeffective) AS dateeffective
             FROM drug_catalog_import_detail
             GROUP BY drug_catalog_hospdrugcode, drug_catalog_dateeffective
             ORDER BY drug_catalog_hospdrugcode, drug_catalog_dateeffective DESC
           ) t
           GROUP BY t.hospdrugcode
           ORDER BY t.dateeffective DESC
         ) c ON d.icode = c.hospdrugcode
         WHERE ${activeWhere}((d.sks_drug_code <> c.tmtid) OR (d.unitprice <> c.unitprice))
         ORDER BY d.icode
         LIMIT ${LIMIT}`
      );

      const graded = rows.map((r: any) => {
        const codeDiff = String(r.sks_drug_code) !== String(r.tmtid);
        const priceDiff = Number(r.drugitem_price) !== Number(r.drugcat_price);
        const problems: string[] = [];
        if (codeDiff) problems.push(r.sks_drug_code === "" ? "ยังไม่ได้ใส่รหัส TMT" : "รหัส TMT ไม่ตรง Catalog");
        if (priceDiff) problems.push("ราคาไม่ตรง Catalog");
        return {
          icode: r.icode,
          name: r.name,
          sks_drug_code: r.sks_drug_code,
          tmtid: r.tmtid,
          drugitem_price: r.drugitem_price,
          drugcat_price: r.drugcat_price,
          dateeffective: r.dateeffective ? String(r.dateeffective).slice(0, 10) : "",
          verdict: problems.length > 0 ? problems.join(" + ") : OK_MARK,
          [ROW_ALERT_KEY]: problems.length > 0,
        };
      });

      const codeCount = graded.filter((r: any) => r.sks_drug_code !== r.tmtid).length;
      const priceCount = graded.filter(
        (r: any) => Number(r.drugitem_price) !== Number(r.drugcat_price)
      ).length;

      const sections: CheckSection[] = [];
      if (graded.length > 0) {
        sections.push({
          title: `ยาที่รหัส TMT หรือราคาไม่ตรงกับ Drug Catalog (${graded.length} รายการ)`,
          columns: [
            { key: "icode", label: "icode" },
            { key: "name", label: "ชื่อยา" },
            { key: "sks_drug_code", label: "TMT ใน drugitems" },
            { key: "tmtid", label: "TMT ใน Catalog" },
            { key: "drugitem_price", label: "ราคาใน drugitems" },
            { key: "drugcat_price", label: "ราคาใน Catalog" },
            { key: "dateeffective", label: "วันที่มีผล" },
            { key: "verdict", label: "ผลตรวจ" },
          ],
          rows: graded,
          note: graded.length >= LIMIT ? `แสดง ${LIMIT} รายการแรก` : undefined,
        });
      }

      // หมวดรายได้ว่าง เป็นคนละเรื่องกับ Catalog แต่ทำให้ส่งเบิกไม่ผ่านเหมือนกัน
      const incomeRows: any = drugCols.has("income")
        ? await selectOnly(
            `SELECT d.icode, d.name, d.unitprice
             FROM drugitems d
             WHERE ${activeWhere}COALESCE(d.income, '') = ''
             ORDER BY d.icode
             LIMIT ${LIMIT}`
          )
        : [];
      if (incomeRows.length > 0) {
        sections.push({
          title: `ยาที่ยังไม่ได้ตั้งหมวดรายได้ (income) — ${incomeRows.length} รายการ`,
          columns: [
            { key: "icode", label: "icode" },
            { key: "name", label: "ชื่อยา" },
            { key: "unitprice", label: "ราคา" },
          ],
          rows: incomeRows.map((r: any) => ({ ...r, [ROW_ALERT_KEY]: true })),
        });
      }

      const problemCount = graded.length + incomeRows.length;

      return {
        id: ID,
        status: problemCount === 0 ? "pass" : "issues",
        problemCount,
        summary:
          problemCount === 0
            ? "รหัส TMT และราคาของยาตรงกับ Drug Catalog ทุกรายการ"
            : `พบ ${graded.length} รายการที่ไม่ตรงกับ Catalog` +
              (codeCount > 0 ? ` (รหัส TMT ${codeCount})` : "") +
              (priceCount > 0 ? ` (ราคา ${priceCount})` : "") +
              (incomeRows.length > 0 ? ` และ ${incomeRows.length} รายการที่ไม่ได้ตั้งหมวดรายได้` : ""),
        sections,
        advice:
          "ยาที่ส่งเบิกต้องมีรหัส TMT (drugitems.sks_drug_code) และราคา (unitprice) ตรงกับ Drug Catalog " +
          "รายการล่าสุดที่นำเข้ามา มิฉะนั้น NDP จะตัดยอดหรือตีกลับ\n\n" +
          "• ยาที่ยังไม่ได้ใส่รหัส TMT: ส่วนใหญ่เป็นยาสมุนไพร/ยาที่เพิ่งเพิ่มเข้าคลัง ให้เอารหัสจากช่อง " +
          "'TMT ใน Catalog' ในตารางนี้ไปกรอกในหน้าจอรายการยาของ HOSxP ได้เลย\n" +
          "• ราคาไม่ตรง: ปรับราคาใน drugitems ให้ตรงกับ Catalog หรือถ้าตั้งใจขายคนละราคา ให้ทบทวนว่าจะกระทบยอดเบิกหรือไม่\n" +
          "• หมวดรายได้ (income) ต้องตั้งเป็นหมวดค่ายาที่ถูกต้อง ไม่ปล่อยว่าง\n\n" +
          "วิธีที่เร็วที่สุดคือนำเข้า Drug Catalog รอบล่าสุดแล้วกดปรับปรุงรหัส/ราคาจากหน้าจอ Drug Catalog ของ HOSxP " +
          "ซึ่งจะไล่แก้ให้ทีเดียวทั้งชุด แทนการแก้ทีละตัว",
      };
    } catch (error: any) {
      return unavailableOutcome(
        ID,
        "เทียบกับ Drug Catalog ไม่ได้ — ตรวจว่าตาราง drug_catalog_import_detail มีข้อมูล และฐานนี้ไม่ได้เปิด ONLY_FULL_GROUP_BY ไว้",
        error
      );
    }
  },
};

export default check;
