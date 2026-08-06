import { useState } from "react";
import type { CheckColumn, CheckSection } from "../lib/precheck/types";

/** จำนวนแถวต่อหน้าของตารางผลตรวจ — เกินเท่านี้จึงเริ่มแบ่งหน้า */
const PAGE_SIZE = 10;

/**
 * เลขหน้าที่จะแสดงบนแถบเลือกหน้า ย่อด้วย … เมื่อมีหลายหน้า
 *
 * แสดงหน้าแรก หน้าสุดท้าย และหน้ารอบๆ หน้าปัจจุบันเสมอ เพราะบางตารางมีเป็นร้อยแถว
 * (ยาที่ยังไม่ได้ตั้งรหัส TMT 117 รายการ = 12 หน้า) ถ้าพิมพ์เลขทุกหน้าจะล้นบรรทัด
 * คืน null แทนตำแหน่งที่ถูกย่อ เพื่อให้ผู้เรียกวาด … เอง
 */
function pageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null);
    out.push(sorted[i]);
  }
  return out;
}

/**
 * ตารางผลตรวจของหัวข้อหนึ่ง พร้อมแท็บย่อย (ผ่าน/ไม่ผ่าน) การแบ่งหน้า และปุ่มส่งออก
 *
 * แยกออกมาเป็น component เพราะใช้ทั้งในหน้ารายละเอียดของแต่ละหัวข้อ
 * (/ndp-precheck/[id]) และเผื่อหน้าอื่นที่ต้องแสดงผลตรวจในอนาคต ถ้าเขียนซ้ำสองที่
 * เวลาแก้ตรรกะแท็บย่อยหรือการแบ่งหน้าจะหลุดไม่ตรงกันทันที
 *
 * สถานะแท็บย่อย/หน้า/การส่งออก เป็นเรื่องภายในของตารางล้วนๆ จึงเก็บไว้ในนี้
 * ไม่ต้องให้หน้าที่เรียกใช้มาถือแทน
 */
export default function PrecheckSections({
  cardTitle,
  sections,
}: {
  cardTitle: string;
  sections: CheckSection[];
}) {
  const [sectionTab, setSectionTab] = useState<Record<string, string>>({});
  // หน้าที่กำลังดูของแต่ละตาราง (คีย์เดียวกับ sectionTab) — ไม่มีค่า = หน้าแรก
  const [sectionPage, setSectionPage] = useState<Record<string, number>>({});
  // ตารางที่กำลังสร้างไฟล์ Excel อยู่ เพื่อกันกดซ้ำ
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  /**
   * ส่งออกทุกแถวของแท็บย่อยที่กำลังดู (ไม่ใช่แค่หน้าปัจจุบัน)
   *
   * เติมคอลัมน์ลำดับให้ตรงกับที่เห็นบนจอ เพราะเลขบนจอนับต่อเนื่องข้ามหน้า
   * ถ้าไฟล์ไม่มีเลขนี้ เวลาคนคุยกันว่า "แถวที่ 37" จะหาไม่เจอในไฟล์
   */
  async function exportRows(
    key: string,
    filename: string,
    columns: CheckColumn[],
    rows: Record<string, unknown>[]
  ) {
    setExportingKey(key);
    const seqKey = "__seq";
    const exportColumns: CheckColumn[] = [{ key: seqKey, label: "ลำดับ" }, ...columns];
    const exportRowsWithSeq = rows.map((row, i) => ({ ...row, [seqKey]: i + 1 }));
    try {
      const res = await fetch("/api/precheck/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, columns: exportColumns, rows: exportRowsWithSeq }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "ส่งออกไฟล์ไม่สำเร็จ");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // ปล่อย object URL ทิ้ง ไม่งั้นไฟล์ค้างในหน่วยความจำจนกว่าจะปิดแท็บ
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert("เรียก API ไม่สำเร็จ");
    } finally {
      setExportingKey(null);
    }
  }

  return (
    <>
      {sections.map((section, idx) => {
        // _alert / _warn เป็นคีย์พิเศษที่ฝั่ง check ใส่มาเพื่อขอให้เน้นแถวเป็นสีแดง (ผิดแน่ๆ)
        // หรือสีเหลือง (น่าสงสัย ควรตรวจทาน) — ดู ROW_ALERT_KEY / ROW_WARN_KEY ใน
        // lib/precheck/types.ts — ไม่ใช่คอลัมน์จริง จึงไม่ถูกวาดเป็นช่องในตาราง
        const failRows = section.rows.filter((r) => r._alert);
        const warnRows = section.rows.filter((r) => !r._alert && r._warn);
        const passRows = section.rows.filter((r) => !r._alert && !r._warn);
        const graded = failRows.length + warnRows.length > 0;

        // ตารางที่ปนทั้งผ่านและไม่ผ่านจะยาวจนหาแถวที่ต้องแก้ไม่เจอ แม้จะเรียงแถวที่ผิดไว้บนสุด
        // แล้วก็ตาม จึงแยกเป็นแท็บย่อยและตั้งค่าเริ่มต้นไว้ที่ "ไม่ผ่าน" เพราะเป็นสิ่งที่คนเปิด
        // ดูรายละเอียดต้องการเห็นก่อนเสมอ
        const subTabs = [
          { key: "fail", label: `ไม่ผ่าน ${failRows.length}`, rows: failRows, cls: "subtab-fail" },
          ...(warnRows.length > 0
            ? [{ key: "warn", label: `ควรตรวจทาน ${warnRows.length}`, rows: warnRows, cls: "subtab-warn" }]
            : []),
          { key: "pass", label: `ผ่าน ${passRows.length}`, rows: passRows, cls: "subtab-pass" },
          { key: "all", label: `ทั้งหมด ${section.rows.length}`, rows: section.rows, cls: "" },
        ];
        const tabKey = String(idx);
        const activeSub =
          sectionTab[tabKey] || (failRows.length > 0 ? "fail" : warnRows.length > 0 ? "warn" : "all");
        const shown = graded ? subTabs.find((t) => t.key === activeSub)?.rows || section.rows : section.rows;

        // สรุปว่าที่ไม่ผ่านนั้นไม่ผ่านด้วยสาเหตุอะไรบ้าง อย่างละกี่ราย — ดูจากคอลัมน์ผลตรวจ
        // ซึ่งทุก check ที่แบ่งผ่าน/ไม่ผ่านใช้ key เดียวกันคือ verdict
        const hasVerdict = section.columns.some((c) => c.key === "verdict");
        const reasons = new Map<string, number>();
        if (hasVerdict) {
          for (const r of [...failRows, ...warnRows]) {
            const key = String(r.verdict || "ไม่ระบุสาเหตุ");
            reasons.set(key, (reasons.get(key) || 0) + 1);
          }
        }

        /**
         * คอลัมน์ไหนควรให้ข้อความขึ้นบรรทัดใหม่ได้
         *
         * ตัดสินทั้งคอลัมน์ ไม่ใช่ทีละช่อง เพื่อให้ความกว้างของคอลัมน์คงที่ทุกแถว
         * คอลัมน์สั้นๆ อย่างรหัส ราคา วันที่ ปล่อยให้อยู่บรรทัดเดียว จะได้ไม่ถูกบีบ
         * จนขึ้นบรรทัดใหม่โดยไม่จำเป็น เหลือแต่คอลัมน์ข้อความยาว (ชื่อยา ชื่อคน ผลตรวจ)
         * ที่ยอมให้ตัดบรรทัด
         */
        const wrapCols = new Set(
          section.columns
            .filter((c) => section.rows.some((r) => String(r[c.key] ?? "").length > 28))
            .map((c) => c.key)
        );

        // ชื่อไฟล์เอาชื่อหัวข้อการ์ดนำหน้า จะได้รู้ว่าไฟล์ไหนมาจากการตรวจอะไรตอนเปิดทีหลัง
        const exportName = `${cardTitle}${section.title ? ` - ${section.title}` : ""}`;
        const exportKey = tabKey;

        /**
         * แบ่งหน้าเมื่อเกิน PAGE_SIZE แถว
         *
         * ต้องหนีบเลขหน้าไม่ให้เกินจำนวนหน้าจริง เพราะการสลับแท็บย่อยทำให้จำนวนแถว
         * เปลี่ยน เช่นดูหน้า 8 ของแท็บ "ทั้งหมด" แล้วสลับไป "ไม่ผ่าน" ที่มีแค่ 2 แถว
         * ถ้าไม่หนีบจะกลายเป็นตารางว่างเปล่าโดยไม่มีอะไรบอกว่าเกิดอะไรขึ้น
         */
        const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
        const page = Math.min(Math.max(1, sectionPage[tabKey] || 1), totalPages);
        const paged = shown.length > PAGE_SIZE;
        const pageRows = paged ? shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : shown;
        const goToPage = (n: number) =>
          setSectionPage((prev) => ({ ...prev, [tabKey]: Math.min(Math.max(1, n), totalPages) }));

        return (
          <div key={idx} style={{ marginTop: idx === 0 ? 0 : 24 }}>
            <div className="precheck-section-head">
              {section.title ? <div className="precheck-section-title">{section.title}</div> : <span />}
              {shown.length > 0 ? (
                <button
                  className="button-ghost precheck-small-btn"
                  onClick={() => exportRows(exportKey, exportName, section.columns, shown)}
                  disabled={exportingKey === exportKey}
                >
                  {exportingKey === exportKey ? "กำลังสร้างไฟล์..." : "ส่งออก Excel"}
                </button>
              ) : null}
            </div>

            {graded ? (
              <>
                <div className="precheck-tally">
                  <span className="tally-pass">ผ่าน {passRows.length} ราย</span>
                  <span className="tally-fail">ไม่ผ่าน {failRows.length} ราย</span>
                  {warnRows.length > 0 ? (
                    <span className="tally-warn">ควรตรวจทาน {warnRows.length} ราย</span>
                  ) : null}
                  <span className="tally-total">จากทั้งหมด {section.rows.length} ราย</span>
                </div>
                {reasons.size > 0 ? (
                  <div className="precheck-reasons">
                    {Array.from(reasons.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, n]) => (
                        <div key={reason}>
                          • {reason} — <strong>{n.toLocaleString()}</strong> ราย
                        </div>
                      ))}
                  </div>
                ) : null}
                <div className="subtabs">
                  {subTabs.map((t) => (
                    <button
                      key={t.key}
                      className={`subtab ${t.cls} ${t.key === activeSub ? "active" : ""}`}
                      onClick={() => {
                        setSectionTab((prev) => ({ ...prev, [tabKey]: t.key }));
                        // เปลี่ยนแท็บย่อยแล้วต้องกลับหน้าแรกเสมอ ไม่งั้นจะค้างอยู่หน้ากลางๆ
                        // ของชุดข้อมูลใหม่ที่ผู้ใช้ยังไม่เคยเห็นแถวแรกเลย
                        setSectionPage((prev) => ({ ...prev, [tabKey]: 1 }));
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {shown.length > 0 ? (
              // ตารางที่แบ่งหน้าแล้วไม่ต้องมีกรอบเลื่อนแนวตั้ง เพราะสิบแถวพอดีหน้าจออยู่แล้ว
              <div className="table-wrap" style={paged ? undefined : { maxHeight: 480, overflowY: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      {/* ทุกตารางในโปรเจ็คต้องมีคอลัมน์ลำดับ เพื่อให้อ้างอิงกันได้ว่า
                          "แถวที่ 37" ตอนคุยทางโทรศัพท์หรือส่งไฟล์ให้กันตรวจ */}
                      <th className="seq-col">ลำดับ</th>
                      {section.columns.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* ตารางที่บอกผลถูก/ผิดต้องติดสีพื้นทุกแถวตามกติกาของโปรเจ็ค แถวที่ถูกต้อง
                        เป็นเขียวอ่อน ส่วนตารางอ้างอิงที่ไม่มีผลถูก/ผิด (graded = false) ปล่อยขาว */}
                    {pageRows.map((row, i) => (
                      <tr
                        key={i}
                        className={
                          row._alert ? "row-alert" : row._warn ? "row-warn" : graded ? "row-ok" : undefined
                        }
                      >
                        {/* นับต่อเนื่องข้ามหน้า ไม่เริ่มนับ 1 ใหม่ทุกหน้า เพราะเลขต้องตรงกับ
                            ลำดับในไฟล์ Excel ที่ส่งออกทั้งชุด ไม่งั้นอ้างอิงกันคนละแถว */}
                        <td className="seq-col">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        {section.columns.map((c) => (
                          <td key={c.key} className={wrapCols.has(c.key) ? "wrap" : undefined}>
                            {row[c.key] === null || row[c.key] === undefined || row[c.key] === "" ? (
                              <span style={{ color: "var(--muted)" }}>-</span>
                            ) : (
                              String(row[c.key])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : graded ? (
              <div className="precheck-note">ไม่มีรายการในกลุ่มนี้</div>
            ) : null}

            {paged ? (
              <div className="pager">
                <span className="pager-info">
                  แสดง {((page - 1) * PAGE_SIZE + 1).toLocaleString()}-
                  {Math.min(page * PAGE_SIZE, shown.length).toLocaleString()} จาก{" "}
                  {shown.length.toLocaleString()} รายการ
                </span>
                <div className="pager-buttons">
                  <button className="pager-btn" onClick={() => goToPage(1)} disabled={page === 1}>
                    ⏮ หน้าแรก
                  </button>
                  <button className="pager-btn" onClick={() => goToPage(page - 1)} disabled={page === 1}>
                    ‹ ก่อนหน้า
                  </button>
                  {pageNumbers(page, totalPages).map((n, i) =>
                    n === null ? (
                      <span key={`gap${i}`} className="pager-gap">…</span>
                    ) : (
                      <button
                        key={n}
                        className={`pager-btn ${n === page ? "active" : ""}`}
                        onClick={() => goToPage(n)}
                      >
                        {n}
                      </button>
                    )
                  )}
                  <button
                    className="pager-btn"
                    onClick={() => goToPage(page + 1)}
                    disabled={page === totalPages}
                  >
                    ถัดไป ›
                  </button>
                  <button
                    className="pager-btn"
                    onClick={() => goToPage(totalPages)}
                    disabled={page === totalPages}
                  >
                    หน้าสุดท้าย ⏭
                  </button>
                </div>
              </div>
            ) : null}

            {section.note ? <div className="precheck-note">{section.note}</div> : null}
          </div>
        );
      })}
    </>
  );
}
