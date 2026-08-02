import { selectOnly } from "../readonly";
import { CheckDefinition, CheckOutcome, CheckSection, unavailableOutcome } from "../types";

const ID = "claim-log";
const PREVIEW_ROWS = 30;
const MAX_PREVIEW_TABLES = 3;

/**
 * ประวัติ/สถานะการส่งเคลมล่าสุด — HOSxP แต่ละรุ่นเก็บ log การส่ง NDP/eClaim
 * คนละตาราง (บางหน่วยส่งผ่านโปรแกรมแยกจึงไม่มี log ในฐานเลย)
 * จึงใช้วิธีค้นหาตารางที่ชื่อเข้าเค้าจาก information_schema แล้วพรีวิวแถวล่าสุด
 * โดยเลือกโชว์คอลัมน์ที่ชื่อสื่อถึงสถานะ/ข้อผิดพลาด/เวลา ให้อัตโนมัติ
 */
const check: CheckDefinition = {
  id: ID,
  title: "ประวัติการส่งเคลมล่าสุด (ค้นหาตาราง log อัตโนมัติ)",
  description: "ค้นตารางในฐานที่ชื่อเกี่ยวกับ ndp / eclaim / export queue แล้วแสดงรายการส่งล่าสุด",
  async run(): Promise<CheckOutcome> {
    try {
      const candidates: any = await selectOnly(
        `SELECT table_name AS t, COALESCE(table_rows, 0) AS r
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND (table_name LIKE '%ndp%'
             OR table_name LIKE '%eclaim%'
             OR table_name LIKE '%claim%export%' OR table_name LIKE '%export%claim%'
             OR table_name LIKE '%claim%send%' OR table_name LIKE '%send%claim%'
             OR table_name LIKE '%claim%log%' OR table_name LIKE '%claim%queue%'
             OR table_name LIKE '%moph%send%' OR table_name LIKE '%fdh%')
         ORDER BY table_name`
      );

      if (candidates.length === 0) {
        return {
          id: ID,
          status: "info",
          problemCount: 0,
          summary: "ไม่พบตาราง log การส่งเคลม NDP ในฐานนี้",
          sections: [],
          advice:
            "HOSxP บางรุ่น/บางหน่วยบริการส่ง 13 แฟ้มผ่านโปรแกรมแยก (เช่น โปรแกรมส่งออกของ สปสช.) จึงไม่มี log ในฐาน HOSxP — " +
            "ให้ตรวจสถานะการส่งจากหน้าเว็บ NDP (https://ndp.nhso.go.th) โดยตรง " +
            "ถ้าทราบชื่อตาราง log ของหน่วยงานคุณ แจ้งผู้ดูแลระบบเพิ่มชื่อตารางใน lib/precheck/checks/claimLog.ts ได้",
        };
      }

      const sections: CheckSection[] = [
        {
          title: "ตารางที่ชื่อเข้าเค้าในฐานนี้",
          columns: [
            { key: "t", label: "ชื่อตาราง" },
            { key: "r", label: "จำนวนแถว (ประมาณ)" },
          ],
          rows: candidates,
        },
      ];

      // พรีวิวแถวล่าสุดของตารางที่มีข้อมูล (สูงสุด 3 ตาราง) — เลือกคอลัมน์เวลา/สถานะ/error อัตโนมัติ
      // จัดลำดับให้ตารางที่ชื่อสื่อว่าเป็น log การส่งจริง (send/log/status/queue, fdh/ndp) มาก่อน
      const score = (t: string) =>
        (/send/.test(t) ? 4 : 0) + (/log|queue/.test(t) ? 2 : 0) + (/status/.test(t) ? 2 : 0) + (/^fdh|^ndp/.test(t) ? 3 : 0);
      const withRows = candidates
        .filter((c: any) => Number(c.r) > 0)
        .sort((a: any, b: any) => score(String(b.t)) - score(String(a.t)))
        .slice(0, MAX_PREVIEW_TABLES);
      for (const cand of withRows) {
        const table = String(cand.t);
        try {
          const colRows: any = await selectOnly(
            `SELECT column_name AS c, data_type AS dt
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ?
             ORDER BY ordinal_position`,
            [table]
          );
          const names: string[] = colRows.map((r: any) => String(r.c));
          const timeCol =
            colRows.find((r: any) => ["datetime", "timestamp"].includes(String(r.dt).toLowerCase()))?.c ||
            names.find((n) => /date|time/i.test(n));
          const interesting = names.filter((n) =>
            /vn|hn|cid|date|time|status|state|success|error|message|result|code|file|rep/i.test(n)
          );
          const showCols = (interesting.length > 0 ? interesting : names).slice(0, 8);

          const rows: any = await selectOnly(
            `SELECT ${showCols.map((c) => `\`${c}\``).join(", ")}
             FROM \`${table}\`
             ${timeCol ? `ORDER BY \`${timeCol}\` DESC` : ""}
             LIMIT ${PREVIEW_ROWS}`
          );
          sections.push({
            title: `รายการล่าสุดใน ${table}${timeCol ? ` (เรียงตาม ${timeCol})` : ""}`,
            columns: showCols.map((c) => ({ key: c, label: c })),
            rows,
          });
        } catch {
          sections.push({
            title: `พรีวิว ${table} ไม่ได้`,
            columns: [],
            rows: [],
            note: `เปิดดูเองด้วย: SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 30`,
          });
        }
      }

      return {
        id: ID,
        status: "info",
        problemCount: 0,
        summary: `พบ ${candidates.length} ตารางที่อาจเป็น log การส่งเคลม — ดูรายการล่าสุดในรายละเอียด`,
        sections,
        advice:
          "การ์ดนี้เป็นข้อมูลประกอบ (ไม่ใช่ผ่าน/ไม่ผ่าน): ใช้ดูว่าการส่งรอบล่าสุดสำเร็จหรือไม่ และมีข้อความ error อะไร " +
          "ถ้าคอลัมน์สถานะแสดงว่าไม่สำเร็จ ให้อ่านข้อความ error แล้วแก้ตามการ์ดตรวจสอบหัวข้อที่เกี่ยวข้อง ก่อนส่งซ้ำ " +
          "สถานะที่เป็นทางการที่สุดให้ยึดจากหน้าเว็บ NDP ของ สปสช.",
      };
    } catch (error) {
      return unavailableOutcome(ID, "ค้นหาตาราง log จาก information_schema ไม่สำเร็จ", error);
    }
  },
};

export default check;
