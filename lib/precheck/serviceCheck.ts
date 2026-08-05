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
   * รหัส ADP ของ สปสช. ที่ต้องผูกกับรายการค่าบริการ
   *
   * ใส่ได้หลายรหัสเพราะบางบริการ สปสช. ให้ใช้รหัสใดรหัสหนึ่งก็ได้ — เจอรหัสไหน
   * รหัสหนึ่งก็ถือว่าเคสนั้นมีค่าบริการแล้ว
   */
  adpCodes?: string[];
  /**
   * ข้อความแทนรายการรหัสในหน้าจอ ใส่เมื่อรหัสไม่ได้มาจากชุดเดียวกันทั้งหมด
   * เช่น "ADP 30014 / 30017 หรือ CSMBS 31101" — ไม่ใส่จะขึ้นว่า "ADP <รหัส>" ตามปกติ
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
  const drugCodes = cfg.drugCodes || [];
  // บริการบางอย่างดูจากรายการยาอย่างเดียว ไม่มีรหัสค่าบริการ ADP ให้ตรวจ
  const needAdp = adpCodes.length > 0;
  const needDrug = drugCodes.length > 0;

  const drugLabel = cfg.drugLabel || (cfg.drugName ? `ยา ${cfg.drugName}` : "รายการยา");
  const drugCodeLabel = drugCodes.join(", ");
  // รายการรหัสยาว 20 กว่ารหัสใส่ในหัวตาราง/ช่องผลตรวจไม่ไหว ย่อเหลือจำนวนรหัส
  // ส่วนรายการเต็มไปอยู่ในคำแนะนำการแก้ไขซึ่งมีที่ให้อ่านพอ
  const drugCodeShort = drugCodes.length > 3 ? `${drugCodes.length} รหัส` : drugCodes.join(" หรือ ");
  const adpLabel = cfg.adpLabel || `ADP ${adpCodes.join(" หรือ ")}`;

  return {
    id: cfg.id,
    title: cfg.title,
    description:
      `เคส${cfg.serviceName} ต้องมี ICD-10 ${icdLabel}` +
      (needAdp ? ` และค่าบริการรหัส ${adpLabel}` : "") +
      (needDrug ? ` และรายการยารหัส ${drugCodeShort}` : "") +
      " (เลือกช่วงวันที่ด้านบน)",
    needsRange: true,
    async run(ctx: CheckContext): Promise<CheckOutcome> {
      try {
        // icode ของแต่ละหน่วยบริการไม่เหมือนกัน จึงต้องถามจากฐานเอง ห้าม hard-code
        const adpItems = needAdp ? await findByAdpCode(adpCodes) : [];
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

        const raw: any = await selectOnly(
          `SELECT c.vn,
                  o.hn,
                  DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
                  TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patient_name,
                  ${icdFoundSql} AS icd_found,
                  ${adpCountSql} AS adp_count,
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
          const drugCount = Number(r.drug_count || 0);
          const hasIcd = icd !== "";
          const hasAdp = adpCount > 0;
          const hasDrug = drugCount > 0;

          const missing: string[] = [];
          if (!hasIcd) missing.push(`ICD-10 ${icdLabel}`);
          if (needAdp && !hasAdp) missing.push(`ค่าบริการ ${adpLabel}`);
          if (needDrug && !hasDrug) missing.push(drugLabel);

          return {
            vstdate: r.vstdate,
            vn: r.vn,
            hn: r.hn,
            patient_name: r.patient_name,
            icd_found: hasIcd ? icd : "",
            adp_found: hasAdp ? `${adpCount} รายการ` : "",
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
        const noAdp = needAdp ? rows.filter((r: any) => !r.adp_found).length : 0;
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
              ...(needAdp ? [{ key: "adp_found", label: `ค่าบริการ ${adpLabel}` }] : []),
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

        const setupMissing = adpMissing || drugMissing;
        const breakdown = [
          noIcd > 0 ? `ขาด ICD-10 ${noIcd} เคส` : "",
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
async function findByAdpCode(adpCodes: string[]): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (const table of ["nondrugitems", "drugitems"]) {
    const cols = await tableColumns(table);
    const adpCol = pickCol(cols, ["nhso_adp_code"]);
    if (!adpCol) continue;
    const rows: any = await selectOnly(
      `SELECT icode, name, REPLACE(COALESCE(${adpCol}, ''), ' ', '') AS adp_code
         FROM ${table}
        WHERE REPLACE(COALESCE(${adpCol}, ''), ' ', '') IN (${ph(adpCodes.length)})
        LIMIT 50`,
      adpCodes
    );
    for (const r of rows) {
      out.push({
        icode: String(r.icode),
        name: String(r.name || ""),
        code: String(r.adp_code || ""),
        source: table,
      });
    }
  }
  return out;
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
