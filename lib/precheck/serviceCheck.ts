import { selectOnly } from "./readonly";
import { tableColumns, pickCol } from "./schema";
import {
  CheckContext,
  CheckDefinition,
  CheckOutcome,
  CheckSection,
  OK_MARK,
  ROW_ALERT_KEY,
  unavailableOutcome,
} from "./types";

const LIMIT = 1000;

/**
 * ตัวสร้าง check สำหรับ "บริการที่ต้องคีย์ข้อมูลครบหลายอย่างถึงจะเบิกได้"
 *
 * สิทธิประโยชน์ส่งเสริมป้องกันของ สปสช. หลายรายการใช้กติกาเดียวกันคือ เคสหนึ่งต้องมี
 * ทั้ง ICD-10, รายการค่าบริการที่ผูกรหัส ADP และบางรายการต้องมีรายการยาด้วย
 * ขาดอย่างใดอย่างหนึ่งก็เบิกไม่ได้ ทั้งที่ให้บริการไปจริงแล้ว
 *
 * เขียนเป็นตัวสร้างกลางเพราะต่างกันแค่ "รหัสอะไรบ้าง" — ถ้าก๊อปโค้ดไปทั้งชุดต่อหนึ่ง
 * บริการ พอแก้ตรรกะทีหลัง (เช่น เพิ่มการรองรับ IPD) จะต้องไล่แก้ทุกไฟล์แล้วตกหล่น
 */
export interface ServiceCheckConfig {
  id: string;
  title: string;
  /** ชื่อบริการสั้นๆ ใช้ประกอบข้อความ เช่น "ตรวจหลังคลอด" */
  serviceName: string;
  /** ICD-10 ที่นับว่าเป็นบริการนี้ เขียนแบบไม่มีจุด เช่น ["Z390","Z391"] */
  icdCodes: string[];
  /**
   * ICD-9-CM (รหัสหัตถการ) ที่ต้องมีคู่กัน — ไม่ใส่ = บริการนี้ไม่ต้องมีหัตถการ
   *
   * ถือว่ามีเมื่อเจอที่ใดที่หนึ่งใน
   *   1) ตาราง opdoprt (หน้าบันทึกหัตถการของ HOSxP)
   *   2) รายการค่าบริการที่คีย์ในวันนั้น ซึ่งตัวรายการผูก icd9cm ไว้ (nondrugitems.icd9cm)
   * เพราะหลายหน่วยไม่ได้คีย์หน้าหัตถการเลย แต่ผูกรหัสไว้กับรายการค่าบริการแทน
   * ถ้าดูแค่ตารางเดียวจะขึ้นว่าขาดทั้งที่คีย์ครบ
   */
  icd9Codes?: string[];
  /**
   * รหัส ADP ของ สปสช. ที่ต้องผูกกับรายการค่าบริการ
   *
   * ใส่ได้หลายรหัสเพราะบางบริการ สปสช. ให้ใช้รหัสใดรหัสหนึ่งก็ได้ — เจอรหัสไหน
   * รหัสหนึ่งก็ถือว่าเคสนั้นมีค่าบริการแล้ว
   */
  adpCodes?: string[];
  /**
   * รหัส bill code (nondrugitems/drugitems.billcode) ที่ใช้ระบุรายการค่าบริการแทน
   * รหัส ADP — บางบริการ สปสช. กำหนดมาเป็น bill code ไม่ใช่ ADP
   *
   * นับรวมกับ adpCodes เป็นเงื่อนไขเดียวกันคือ "เคสนี้มีรายการค่าบริการหรือยัง"
   * เจอรหัสไหนรหัสหนึ่งจากทั้งสองชุดก็ถือว่ามีแล้ว
   */
  billCodes?: string[];
  /**
   * รหัส TMLT (มาตรฐานรายการตรวจแล็บ) ที่ยืนยันว่าให้บริการแล้ว
   *
   * นับรวมเป็นเงื่อนไขเดียวกับ adpCodes/billCodes คือ "เคสนี้มีหลักฐานว่าให้บริการแล้ว
   * หรือยัง" เจอทางใดทางหนึ่งก็พอ เพราะ สปสช. ยอมรับได้ทั้งการคีย์ค่าบริการและการสั่งแล็บ
   *
   * รหัสนี้อยู่ที่ lab_items.tmlt_code ซึ่งเป็นทะเบียนรายการแล็บ คนละที่กับรายการ
   * ค่าบริการ จึงต้องไล่ผ่าน lab_head -> lab_order -> lab_items
   */
  labTmltCodes?: string[];
  /**
   * ข้อความแทนรายการรหัสในหน้าจอ ใส่เมื่อรหัสไม่ได้มาจากชุดเดียวกันทั้งหมด
   * เช่น "ADP 30014 / 30017 หรือ CSMBS 31101" — ไม่ใส่จะประกอบจากรหัสที่ให้มาเอง
   */
  adpLabel?: string;
  /**
   * รหัสยา/TMT (drugitems) ที่ต้องมีคู่กัน — ไม่ใส่ = บริการนี้ไม่ต้องมีรายการยา
   * ใส่กี่รหัสก็ได้ เจอรหัสไหนรหัสหนึ่งก็ถือว่าเคสนั้นมีรายการยาแล้ว
   */
  drugCodes?: string[];
  /** ชื่อยาไว้แสดงในข้อความ เช่น "Triferdine" (จะขึ้นว่า "ยา Triferdine") */
  drugName?: string;
  /** ข้อความแทนชื่อยาแบบเต็ม ใส่เมื่อเป็นกลุ่มยาไม่ใช่ตัวเดียว เช่น "ยาเม็ด/ยาฉีดคุมกำเนิด" */
  drugLabel?: string;
  /** ข้อความต่อท้ายคำแนะนำ เช่น เงื่อนไขจำนวนครั้งที่เบิกได้ */
  extraAdvice?: string;
}

interface ItemRow {
  icode: string;
  name: string;
  /** รหัสที่ตั้งไว้จริงกับรายการนี้ (ADP หรือรหัสยา) — บอกให้รู้ว่าเจอด้วยรหัสไหน */
  code: string;
  /** ที่มาของรายการ: ชื่อตาราง (ฝั่ง ADP) หรือชื่อคอลัมน์ที่เก็บรหัส (ฝั่งยา) */
  source: string;
}

export function createServiceCheck(cfg: ServiceCheckConfig): CheckDefinition {
  const icdList = expandIcd(cfg.icdCodes);
  const icdLabel = cfg.icdCodes.join(" / ");
  const adpCodes = cfg.adpCodes || [];
  const billCodes = cfg.billCodes || [];
  const drugCodes = cfg.drugCodes || [];
  const labCodes = cfg.labTmltCodes || [];
  const needLab = labCodes.length > 0;
  const icd9List = expandIcd(cfg.icd9Codes || []);
  const needIcd9 = icd9List.length > 0;
  const icd9Label = (cfg.icd9Codes || []).join(" / ");
  // บริการบางอย่างดูจากรายการยาอย่างเดียว ไม่มีรหัสค่าบริการให้ตรวจ
  const needAdp = adpCodes.length + billCodes.length + labCodes.length > 0;
  const needDrug = drugCodes.length > 0;

  const drugLabel = cfg.drugLabel || (cfg.drugName ? `ยา ${cfg.drugName}` : "รายการยา");
  const drugCodeLabel = drugCodes.join(", ");
  // รายการรหัสยาว 20 กว่ารหัสใส่ในหัวตาราง/ช่องผลตรวจไม่ไหว ย่อเหลือจำนวนรหัส
  // ส่วนรายการเต็มไปอยู่ในคำแนะนำการแก้ไขซึ่งมีที่ให้อ่านพอ
  const drugCodeShort = drugCodes.length > 3 ? `${drugCodes.length} รหัส` : drugCodes.join(" หรือ ");
  const adpLabel =
    cfg.adpLabel ||
    [
      adpCodes.length ? `ADP ${adpCodes.join(" หรือ ")}` : "",
      billCodes.length ? `bill code ${billCodes.join(" หรือ ")}` : "",
      labCodes.length ? `TMLT ${labCodes.join(" หรือ ")}` : "",
    ]
      .filter(Boolean)
      .join(" หรือ ");

  return {
    id: cfg.id,
    title: cfg.title,
    description:
      `เคส${cfg.serviceName} ต้องมี ICD-10 ${icdLabel}` +
      (needIcd9 ? ` และ ICD-9-CM ${icd9Label}` : "") +
      (needAdp ? ` และค่าบริการรหัส ${adpLabel}` : "") +
      (needDrug ? ` และรายการยารหัส ${drugCodeShort}` : "") +
      " (เลือกช่วงวันที่ด้านบน)",
    needsRange: true,
    async run(ctx: CheckContext): Promise<CheckOutcome> {
      try {
        // icode ของแต่ละหน่วยบริการไม่เหมือนกัน จึงต้องถามจากฐานเอง ห้าม hard-code
        const adpItems = needAdp ? await findServiceItems(adpCodes, billCodes) : [];
        const drugItems = needDrug ? await findByDrugCode(drugCodes) : [];
        const adpIcodes = adpItems.map((i) => i.icode);
        const drugIcodes = drugItems.map((i) => i.icode);
        const allIcodes = Array.from(new Set([...adpIcodes, ...drugIcodes]));

        const params: unknown[] = [];

        // ---- คอลัมน์ผลตรวจของแต่ละเคส (subquery ต่อแถว เพราะชุดเคสมีไม่มาก) ----
        params.push(...icdList);
        const icdFoundSql = `(SELECT GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10 SEPARATOR ', ')
                                FROM ovstdiag d
                               WHERE d.vn = c.vn AND d.icd10 IN (${ph(icdList.length)}))`;

        // รายการค่าบริการที่ผูกรหัสหัตถการ (icd9cm) ไว้ — ใช้เป็นอีกทางที่ถือว่า
        // เคสนั้นมีหัตถการแล้ว สำหรับหน่วยที่ไม่ได้คีย์หน้าหัตถการของ HOSxP
        const icd9Items = needIcd9 ? await findByIcd9(icd9List) : [];
        const icd9Icodes = icd9Items.map((i) => i.icode);
        const hasOpdoprt = needIcd9 ? (await tableColumns("opdoprt")).size > 0 : false;

        // ต้องเป็น subquery เดี่ยวๆ แล้วเอามาต่อกันด้วย CONCAT_WS ห้ามยัด UNION ไว้ใน
        // derived table เพราะ MariaDB ไม่ยอมให้ตารางที่ derive ข้างในอ้างคอลัมน์ของ
        // query ข้างนอก (c.vn) จะฟ้อง Unknown column ทันที ส่วน CONCAT_WS ข้าม NULL
        // ให้เอง ฝั่งไหนไม่เจอก็ยังได้ค่าจากอีกฝั่ง
        let icd9FoundSql = "''";
        if (needIcd9) {
          const parts: string[] = [];
          if (hasOpdoprt) {
            params.push(...icd9List);
            parts.push(`(SELECT GROUP_CONCAT(DISTINCT REPLACE(op.icd9, '.', '') SEPARATOR ', ')
                           FROM opdoprt op
                          WHERE op.vn = c.vn AND op.icd9 IN (${ph(icd9List.length)}))`);
          }
          if (icd9Icodes.length > 0) {
            params.push(...icd9Icodes);
            parts.push(`(SELECT GROUP_CONCAT(DISTINCT REPLACE(COALESCE(nd.icd9cm, ''), '.', '') SEPARATOR ', ')
                           FROM opitemrece i
                           JOIN nondrugitems nd ON nd.icode = i.icode
                          WHERE i.vn = c.vn AND i.icode IN (${ph(icd9Icodes.length)}))`);
          }
          if (parts.length > 0) {
            icd9FoundSql = `CONCAT_WS(', ', ${parts.join(", ")})`;
          }
        }

        // รายการแล็บที่ตั้งรหัส TMLT ตรงกับที่กำหนด
        const labItems = needLab ? await findLabItems(labCodes) : [];
        const labItemCodes = labItems.map((i) => i.icode);

        let labCountSql = "0";
        if (labItemCodes.length > 0) {
          params.push(...labItemCodes);
          labCountSql = `(SELECT COUNT(*)
                            FROM lab_head lh
                            JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
                           WHERE lh.vn = c.vn AND lo.lab_items_code IN (${ph(labItemCodes.length)}))`;
        }

        let adpCountSql = "0";
        if (adpIcodes.length > 0) {
          params.push(...adpIcodes);
          adpCountSql = `(SELECT COUNT(*) FROM opitemrece i
                           WHERE i.vn = c.vn AND i.icode IN (${ph(adpIcodes.length)}))`;
        }

        let drugCountSql = "0";
        if (drugIcodes.length > 0) {
          params.push(...drugIcodes);
          drugCountSql = `(SELECT COUNT(*) FROM opitemrece i
                            WHERE i.vn = c.vn AND i.icode IN (${ph(drugIcodes.length)}))`;
        }

        // ---- ชุดเคสที่ต้องตรวจ = เคสที่เข้าเงื่อนไขอย่างน้อยหนึ่งข้อ ----
        // ต้องรวมจากทุกฝั่ง ไม่ใช่ไล่จากฝั่งเดียว เพราะถ้าไล่จาก ICD อย่างเดียวจะไม่เห็น
        // เคสที่คีย์ค่าบริการ/ยาแล้วแต่ลืมลง dx และกลับกันก็เช่นกัน
        params.push(ctx.from, ctx.to, ...icdList);
        let candidateSql = `SELECT DISTINCT d.vn
                              FROM ovstdiag d
                             WHERE d.vstdate BETWEEN ? AND ? AND d.icd10 IN (${ph(icdList.length)})`;
        if (allIcodes.length > 0) {
          params.push(ctx.from, ctx.to, ...allIcodes);
          candidateSql += `
                             UNION
                            SELECT DISTINCT i.vn
                              FROM opitemrece i
                             WHERE i.vstdate BETWEEN ? AND ? AND i.icode IN (${ph(allIcodes.length)})`;
        }
        // เคสที่สั่งแล็บไว้แต่ยังไม่ได้ลง dx ก็ต้องเห็นด้วย
        if (needLab && labItemCodes.length > 0) {
          params.push(ctx.from, ctx.to, ...labItemCodes);
          candidateSql += `
                             UNION
                            SELECT DISTINCT lh.vn
                              FROM lab_head lh
                              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
                             WHERE lh.order_date BETWEEN ? AND ?
                               AND lo.lab_items_code IN (${ph(labItemCodes.length)})`;
        }
        // เคสที่บันทึกหัตถการไว้แต่ยังไม่ได้ลง dx ก็ต้องเห็นด้วย ไม่งั้นจะตกหล่น
        if (needIcd9 && hasOpdoprt) {
          params.push(ctx.from, ctx.to, ...icd9List);
          candidateSql += `
                             UNION
                            SELECT DISTINCT op.vn
                              FROM opdoprt op
                             WHERE op.opdate BETWEEN ? AND ? AND op.icd9 IN (${ph(icd9List.length)})`;
        }
        if (needIcd9 && icd9Icodes.length > 0) {
          params.push(ctx.from, ctx.to, ...icd9Icodes);
          candidateSql += `
                             UNION
                            SELECT DISTINCT i.vn
                              FROM opitemrece i
                             WHERE i.vstdate BETWEEN ? AND ? AND i.icode IN (${ph(icd9Icodes.length)})`;
        }

        const raw: any = await selectOnly(
          `SELECT c.vn,
                  o.hn,
                  DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
                  TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patient_name,
                  ${icdFoundSql} AS icd_found,
                  ${icd9FoundSql} AS icd9_found,
                  ${adpCountSql} AS adp_count,
                  ${labCountSql} AS lab_count,
                  ${drugCountSql} AS drug_count
           FROM (${candidateSql}) c
           JOIN ovst o ON o.vn = c.vn
           LEFT JOIN patient p ON p.hn = o.hn
           ORDER BY o.vstdate, c.vn
           LIMIT ${LIMIT}`,
          params
        );

        const rows = raw.map((r: any) => {
          const icd = String(r.icd_found || "").trim();
          const adpCount = Number(r.adp_count || 0);
          const labCount = Number(r.lab_count || 0);
          const drugCount = Number(r.drug_count || 0);
          const hasIcd = icd !== "";
          // เจอทางใดทางหนึ่งก็ถือว่ามีหลักฐานว่าให้บริการแล้ว (ค่าบริการ หรือ ผลแล็บ)
          const hasAdp = adpCount > 0 || labCount > 0;
          const hasDrug = drugCount > 0;

          const icd9 = String(r.icd9_found || "").trim();
          const hasIcd9 = icd9 !== "";

          const missing: string[] = [];
          if (!hasIcd) missing.push(`ICD-10 ${icdLabel}`);
          if (needIcd9 && !hasIcd9) missing.push(`ICD-9-CM ${icd9Label}`);
          if (needAdp && !hasAdp) missing.push(`ค่าบริการ ${adpLabel}`);
          if (needDrug && !hasDrug) missing.push(drugLabel);

          return {
            vstdate: r.vstdate,
            vn: r.vn,
            hn: r.hn,
            patient_name: r.patient_name,
            icd_found: hasIcd ? icd : "",
            icd9_found: hasIcd9 ? icd9 : "",
            adp_found: adpCount > 0 ? `${adpCount} รายการ` : "",
            lab_found: labCount > 0 ? `${labCount} รายการ` : "",
            drug_found: hasDrug ? `${drugCount} รายการ` : "",
            verdict: missing.length === 0 ? OK_MARK : `ขาด ${missing.join(" + ")}`,
            [ROW_ALERT_KEY]: missing.length > 0,
          };
        });

        // เคสที่ต้องแก้ขึ้นก่อน เพราะตารางเลื่อนดูในกรอบสูง 360px
        rows.sort((a: any, b: any) => {
          if (a[ROW_ALERT_KEY] !== b[ROW_ALERT_KEY]) return a[ROW_ALERT_KEY] ? -1 : 1;
          return String(a.vstdate).localeCompare(String(b.vstdate));
        });

        const total = rows.length;
        const bad = rows.filter((r: any) => r[ROW_ALERT_KEY]).length;
        const noIcd = rows.filter((r: any) => !r.icd_found).length;
        const noIcd9 = needIcd9 ? rows.filter((r: any) => !r.icd9_found).length : 0;
        const noAdp = needAdp
          ? rows.filter((r: any) => !r.adp_found && !r.lab_found).length
          : 0;
        const noDrug = needDrug ? rows.filter((r: any) => !r.drug_found).length : 0;

        // ไม่มีรายการไหนผูกรหัสไว้เลย = ตั้งค่าไม่ครบตั้งแต่ต้น ต้องบอกก่อนอย่างอื่น
        // เพราะจะทำให้ทุกเคสขึ้นว่าขาด ซึ่งไล่แก้ทีละเคสไม่มีทางจบ
        const adpMissing = needAdp && adpItems.length === 0;
        const drugMissing = needDrug && drugItems.length === 0;

        const sections: CheckSection[] = [];
        if (total > 0) {
          sections.push({
            // เว้นวรรคหลังชื่อบริการเสมอ เพราะชื่อที่ลงท้ายด้วยอักษรอังกฤษ (Triferdine)
            // ติดกับคำไทยแล้วอ่านยาก
            title: `เคส${cfg.serviceName} ในช่วง ${ctx.from} ถึง ${ctx.to} (${total} เคส)`,
            columns: [
              { key: "vstdate", label: "วันที่รับบริการ" },
              { key: "vn", label: "VN" },
              { key: "hn", label: "HN" },
              { key: "patient_name", label: "ชื่อ-สกุล" },
              { key: "icd_found", label: `ICD-10 (${icdLabel})` },
              ...(needIcd9 ? [{ key: "icd9_found", label: `ICD-9-CM (${icd9Label})` }] : []),
              ...(needAdp ? [{ key: "adp_found", label: "ค่าบริการที่คีย์" }] : []),
              ...(needLab ? [{ key: "lab_found", label: `แล็บ TMLT ${labCodes.join("/")}` }] : []),
              ...(needDrug ? [{ key: "drug_found", label: drugLabel }] : []),
              { key: "verdict", label: "ผลตรวจ" },
            ],
            rows,
            note:
              total >= LIMIT
                ? `แสดง ${LIMIT} รายการแรก — ย่อช่วงวันที่เพื่อดูครบ`
                : bad > 0
                  ? "แถวสีแดงคือเคสที่ข้อมูลไม่ครบ ต้องกลับไปคีย์เพิ่มใน HOSxP ก่อนส่งเคลม"
                  : undefined,
          });
        }

        if (needAdp) {
          sections.push({
            title: `รายการค่าบริการที่ผูกรหัส ${adpLabel} ในฐานนี้`,
            columns: [
              { key: "icode", label: "icode" },
              { key: "name", label: "ชื่อรายการ" },
              { key: "code", label: "รหัสที่ผูกไว้" },
              { key: "source", label: "ตาราง" },
            ],
            rows: adpItems.map((i) => ({ icode: i.icode, name: i.name, code: i.code, source: i.source })),
            note: adpMissing
              ? `ยังไม่มีรายการค่าบริการใดผูกรหัส ${adpLabel} ไว้เลย — ทุกเคสจึงขึ้นว่าขาดค่าบริการ ต้องไปตั้งรหัสก่อน`
              : undefined,
          });
        }

        if (needLab) {
          sections.push({
            title: `รายการแล็บที่ตั้งรหัส TMLT ${labCodes.join(" หรือ ")} ในฐานนี้`,
            columns: [
              { key: "icode", label: "lab_items_code" },
              { key: "name", label: "ชื่อรายการแล็บ" },
              { key: "code", label: "TMLT ที่ตั้งไว้" },
            ],
            rows: labItems.map((i) => ({ icode: i.icode, name: i.name, code: i.code })),
            note:
              labItems.length === 0
                ? `ยังไม่มีรายการแล็บใดตั้งรหัส TMLT ${labCodes.join(" หรือ ")} ไว้เลย — ` +
                  `ถ้าหน่วยบริการใช้ทางแล็บเป็นหลัก ต้องไปตั้งรหัสที่ทะเบียนรายการแล็บก่อน`
                : undefined,
          });
        }

        if (needDrug) {
          sections.push({
            title: `รายการยาที่ตั้งรหัสตรงกับที่ สปสช. กำหนด (${drugCodeShort}) ในฐานนี้`,
            columns: [
              { key: "icode", label: "icode" },
              { key: "name", label: "ชื่อยา" },
              { key: "code", label: "รหัสยาที่ตั้งไว้" },
              { key: "source", label: "ตั้งไว้ในช่อง" },
            ],
            rows: drugItems.map((d) => ({ icode: d.icode, name: d.name, code: d.code, source: d.source })),
            note: drugMissing
              ? `ยังไม่มีรายการยาใดในฐานนี้ตั้งรหัสตรงกับรายการที่ สปสช. กำหนดเลย — ทุกเคสจึงขึ้นว่าขาดยา ` +
                `ต้องไปตั้งรหัสยาก่อน (รหัสที่ยอมรับ: ${drugCodeLabel})`
              : undefined,
          });
        }

        // ถ้าตั้งไว้ทั้งสองทาง (ค่าบริการ/แล็บ) ขอแค่ทางใดทางหนึ่งพร้อมก็ยังตรวจได้
        const serviceSetupMissing = needLab ? adpMissing && labItems.length === 0 : adpMissing;
        const setupMissing = serviceSetupMissing || drugMissing;
        const breakdown = [
          noIcd > 0 ? `ขาด ICD-10 ${noIcd} เคส` : "",
          noIcd9 > 0 ? `ขาด ICD-9-CM ${noIcd9} เคส` : "",
          noAdp > 0 ? `ขาดค่าบริการ ${noAdp} เคส` : "",
          noDrug > 0 ? `ขาด${drugLabel} ${noDrug} เคส` : "",
        ].filter(Boolean);

        const summary =
          total === 0
            ? setupMissing
              ? `ไม่พบเคส${cfg.serviceName} ในช่วงวันที่ที่เลือก และยังตั้งรหัสไม่ครบ (ดูรายละเอียด)`
              : `ไม่พบเคส${cfg.serviceName} ในช่วงวันที่ที่เลือก`
            : bad === 0
              ? `เคส${cfg.serviceName} ทั้ง ${total} เคสมีข้อมูลครบแล้ว`
              : `พบ ${bad} จาก ${total} เคสที่ข้อมูลไม่ครบ — ${breakdown.join(", ")}`;

        return {
          id: cfg.id,
          // ไม่มีเคสเลยในช่วงวันที่ที่เลือก = ยังตัดสินไม่ได้ว่าผ่านหรือไม่ผ่าน จึงไม่ติดสี
          // ทั้งเขียวและแดง (สีแดงจะทำให้เข้าใจผิดว่ามีอะไรเสียหาย ทั้งที่แค่ยังไม่มีข้อมูล)
          // เรื่องรหัสที่ยังตั้งไม่ครบยังบอกไว้ในบรรทัดสรุปและในตารางด้านล่างเหมือนเดิม
          status: total === 0 ? "empty" : bad > 0 ? "issues" : "pass",
          problemCount: total === 0 ? 0 : bad,
          summary,
          sections,
          advice:
            `สปสช. จ่ายค่าบริการ${cfg.serviceName} เมื่อเคสนั้นมีข้อมูลครบทุกอย่าง คือ ICD-10 ${icdLabel}` +
            (needAdp ? ` และรายการค่าบริการที่ผูกรหัส ${adpLabel}` : "") +
            (needDrug ? ` และรายการยาที่ตั้งรหัสตรงกับที่ สปสช. กำหนด` : "") +
            ` — ขาดอย่างใดอย่างหนึ่งก็เบิกไม่ได้ ทั้งที่ให้บริการไปจริง\n\n` +
            `• เคสที่ขาดค่าบริการหรือยา: เปิด visit นั้นใน HOSxP แล้วคีย์รายการเพิ่ม ` +
            `(ห้าม INSERT ลง opitemrece เองจาก SQL เพราะยอดค่ารักษา/ใบแจ้งหนี้จะไม่ตรงกัน)\n` +
            `• เคสที่ขาด ICD-10: ลงวินิจฉัย ${icdLabel} เพิ่มที่หน้าห้องตรวจของ visit นั้น\n` +
            (needIcd9
              ? `• เคสที่ขาด ICD-9-CM: บันทึกหัตถการ ${icd9Label} ที่หน้าหัตถการของ visit นั้น ` +
                `หรือผูกรหัสหัตถการไว้กับรายการค่าบริการ (ช่อง icd9cm ของรายการค่ารักษา) ` +
                `เพื่อให้ระบบมองเห็นจากรายการที่คีย์ไปแล้วได้เลย\n`
              : "") +
            `• ถ้าตารางด้านล่างไม่มีรายการใดผูกรหัสไว้เลย ให้ไปตั้งรหัสที่ HOSxP เมนูตั้งค่า > ค่ารักษาพยาบาล ` +
            `(รายการค่าบริการ) หรือหน้าจอรายการยา แล้วใส่รหัสให้ตรง — ตั้งครั้งเดียวใช้ได้ตลอด\n` +
            (needDrug ? `\nรหัสยาที่ สปสช. ยอมรับสำหรับบริการนี้: ${drugCodeLabel}\n` : "") +
            (cfg.extraAdvice ? `\n${cfg.extraAdvice}\n` : "") +
            `\nหมายเหตุ: ตรวจเฉพาะผู้ป่วยนอก (ovst) เพราะบริการที่เบิกด้วยรหัสนี้เป็นบริการผู้ป่วยนอก`,
        };
      } catch (error) {
        return unavailableOutcome(
          cfg.id,
          "ตรวจสอบว่าฐานนี้มีตาราง ovst / ovstdiag / opitemrece / nondrugitems / drugitems หรือไม่",
          error
        );
      }
    },
  };
}

/**
 * เติมรูปแบบที่มีจุดให้กับรหัส ICD-10 ที่รับมา (Z392 -> Z39.2)
 *
 * HOSxP บางหน่วยคีย์ "Z39.2" บางหน่วยคีย์ "Z392" — เขียนเป็นรายการค่าคงที่ทั้งสองแบบ
 * แทนการใช้ REPLACE(icd10,'.','') ใน WHERE เพื่อให้ยังใช้ index ของ ovstdiag.icd10 ได้
 * ไม่งั้นช่วงวันที่กว้างๆ จะช้ามาก
 */
function expandIcd(codes: string[]): string[] {
  const out = new Set<string>();
  for (const raw of codes) {
    const code = raw.trim();
    out.add(code);
    const plain = code.replace(/\./g, "");
    out.add(plain);
    if (plain.length > 3) out.add(`${plain.slice(0, 3)}.${plain.slice(3)}`);
  }
  return Array.from(out);
}

/** สร้าง placeholder "?, ?, ?" ตามจำนวนที่ต้องการ */
function ph(n: number): string {
  return new Array(n).fill("?").join(", ");
}

/**
 * รายการที่ผูกรหัส ADP ไว้ — ดูทั้งฝั่งค่าบริการและฝั่งยา
 *
 * ปกติค่าบริการอยู่ใน nondrugitems แต่บางหน่วยตั้งไว้ใน drugitems จึงดูทั้งสองตาราง
 * และเช็คก่อนว่ามีคอลัมน์ nhso_adp_code จริง เพราะ HOSxP รุ่นเก่าบางรุ่นยังไม่มี
 */
async function findServiceItems(adpCodes: string[], billCodes: string[]): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (const table of ["nondrugitems", "drugitems"]) {
    const cols = await tableColumns(table);
    const adpCol = pickCol(cols, ["nhso_adp_code"]);
    const billCol = pickCol(cols, ["billcode"]);

    // รหัส CSMBS (ที่ส่งมาทาง billCodes) อยู่ได้ทั้งช่อง billcode และ nhso_adp_code
    // แล้วแต่ว่าหน่วยบริการกรอกไว้ตรงไหน จึงต้องค้นทั้งสองช่อง ถ้าค้นช่องเดียวจะ
    // ไม่เจอรายการของหน่วยที่กรอกไว้อีกช่อง แล้วขึ้นว่าขาดค่าบริการทั้งที่คีย์ครบ
    const adpSearch = [...adpCodes, ...billCodes];
    const billSearch = billCodes;
    const useAdpCol = adpCol && adpSearch.length > 0;
    const useBillCol = billCol && billSearch.length > 0;
    if (!useAdpCol && !useBillCol) continue;

    // เทียบแบบตัดช่องว่างทิ้งทั้งสองฝั่ง เพราะบางหน่วยพิมพ์รหัสติดช่องว่างมาด้วย
    const conds: string[] = [];
    const params: unknown[] = [];
    if (useAdpCol) {
      conds.push(`REPLACE(COALESCE(${adpCol}, ''), ' ', '') IN (${ph(adpSearch.length)})`);
      params.push(...adpSearch);
    }
    if (useBillCol) {
      conds.push(`REPLACE(COALESCE(${billCol}, ''), ' ', '') IN (${ph(billSearch.length)})`);
      params.push(...billSearch);
    }

    const rows: any = await selectOnly(
      `SELECT icode, name
              ${useAdpCol ? `, REPLACE(COALESCE(${adpCol}, ''), ' ', '') AS adp_code` : ""}
              ${useBillCol ? `, REPLACE(COALESCE(${billCol}, ''), ' ', '') AS bill_code` : ""}
         FROM ${table}
        WHERE ${conds.join(" OR ")}
        LIMIT 50`,
      params
    );

    for (const r of rows) {
      // บอกด้วยว่าเจอด้วยรหัสฝั่งไหน เพราะรายการเดียวกันอาจตั้งไว้คนละช่อง
      const byAdp = useAdpCol && adpSearch.includes(String(r.adp_code));
      out.push({
        icode: String(r.icode),
        name: String(r.name || ""),
        code: byAdp ? String(r.adp_code) : `${r.bill_code} (bill code)`,
        source: table,
      });
    }
  }
  return out;
}

/**
 * รายการแล็บที่ตั้งรหัส TMLT ตรงกับที่กำหนด
 *
 * TMLT อยู่ในทะเบียนรายการแล็บ (lab_items) ไม่ใช่รายการค่าบริการ การจะรู้ว่าเคสหนึ่ง
 * ตรวจแล็บตัวนั้นหรือยัง จึงต้องไล่ผ่าน lab_head -> lab_order -> lab_items
 *
 * คืน icode เป็น lab_items_code เพื่อให้ผู้เรียกใช้ต่อได้เหมือนรายการอื่น
 */
async function findLabItems(tmltCodes: string[]): Promise<ItemRow[]> {
  const cols = await tableColumns("lab_items");
  const codeCol = pickCol(cols, ["tmlt_code", "tlmt_code"]);
  const nameCol = pickCol(cols, ["lab_items_name", "name"]);
  if (!codeCol || cols.size === 0) return [];
  // ไม่มีตารางใบสั่งแล็บก็ตรวจต่อไม่ได้ ถือว่าไม่มีรายการ
  if ((await tableColumns("lab_head")).size === 0 || (await tableColumns("lab_order")).size === 0) {
    return [];
  }

  const rows: any = await selectOnly(
    `SELECT lab_items_code, ${nameCol ? nameCol : "''"} AS name,
            REPLACE(COALESCE(${codeCol}, ''), ' ', '') AS tmlt
       FROM lab_items
      WHERE REPLACE(COALESCE(${codeCol}, ''), ' ', '') IN (${ph(tmltCodes.length)})
      LIMIT 50`,
    tmltCodes
  );

  return rows.map((r: any) => ({
    icode: String(r.lab_items_code),
    name: String(r.name || ""),
    code: String(r.tmlt || ""),
    source: "lab_items.tmlt_code",
  }));
}

/**
 * รายการค่าบริการที่ผูกรหัสหัตถการ (icd9cm) ตรงกับที่กำหนด
 *
 * ใช้เป็นอีกทางที่ถือว่าเคสนั้นมีหัตถการแล้ว สำหรับหน่วยบริการที่ไม่ได้คีย์หน้า
 * หัตถการของ HOSxP แต่ผูกรหัสไว้กับรายการค่าบริการแทน (พบว่าเป็นวิธีที่ใช้จริง
 * มากกว่าในฐานที่ตรวจ ซึ่งตาราง opdoprt ว่างเปล่าทั้งตาราง)
 */
async function findByIcd9(icd9List: string[]): Promise<ItemRow[]> {
  const cols = await tableColumns("nondrugitems");
  const col = pickCol(cols, ["icd9cm", "icd9"]);
  if (!col) return [];

  const rows: any = await selectOnly(
    `SELECT icode, name, REPLACE(COALESCE(${col}, ''), '.', '') AS icd9
       FROM nondrugitems
      WHERE REPLACE(COALESCE(${col}, ''), '.', '') IN (${ph(icd9List.length)})
      LIMIT 50`,
    icd9List
  );

  return rows.map((r: any) => ({
    icode: String(r.icode),
    name: String(r.name || ""),
    code: String(r.icd9 || ""),
    source: "nondrugitems.icd9cm",
  }));
}

/**
 * รายการยาที่ตั้งรหัสยามาตรฐานตรงกับที่ สปสช. กำหนด
 *
 * รหัสยาที่ HOSxP ส่งออกไป NDP อยู่ใน drugitems.sks_drug_code แต่บางหน่วยกรอกไว้ใน
 * ช่อง TMT แทน จึงยอมรับหลายคอลัมน์ และคืนชื่อคอลัมน์ที่เจอกลับไปด้วย เพื่อให้ผู้ใช้
 * เห็นว่ารหัสไปอยู่ช่องไหน (source ของแถวนี้จึงเป็นชื่อคอลัมน์ ไม่ใช่ชื่อตาราง)
 */
async function findByDrugCode(drugCodes: string[]): Promise<ItemRow[]> {
  const cols = await tableColumns("drugitems");
  const candidates = ["sks_drug_code", "tmt_tp_code", "tmt_gp_code", "ttmt_code"].filter((c) => cols.has(c));
  if (candidates.length === 0) return [];

  const conds = candidates.map((c) => `${c} IN (${ph(drugCodes.length)})`);
  const params: unknown[] = [];
  for (const _ of candidates) params.push(...drugCodes);

  const rows: any = await selectOnly(
    `SELECT icode, name, ${candidates.map((c) => `COALESCE(${c}, '') AS ${c}`).join(", ")}
       FROM drugitems
      WHERE ${conds.join(" OR ")}
      LIMIT 50`,
    params
  );

  return rows.map((r: any) => {
    const hit = candidates.find((c) => drugCodes.includes(String(r[c])));
    return {
      icode: String(r.icode),
      name: String(r.name || ""),
      code: hit ? String(r[hit]) : "",
      source: hit || "",
    };
  });
}
