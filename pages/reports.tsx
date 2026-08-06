import { GetServerSideProps } from "next";
import { useEffect, useRef, useState } from "react";
import Layout from "../components/Layout";
import { getHospitalName } from "../lib/db";
import { getSession } from "../lib/session";
import { ReportDefinition, ReportParam, ReportParamType } from "../lib/reports/types";

/**
 * หน้านี้ต้องเข้าสู่ระบบก่อนเสมอ — ตรวจฝั่งเซิร์ฟเวอร์ ไม่ใช่ฝั่งเบราว์เซอร์
 *
 * ถ้าไม่มีบรรทัดนี้ Next จะสร้างหน้าเป็นไฟล์ static แล้วส่งให้ทุกคนที่เปิด URL ได้เลย
 * (แถบเมนูจะขึ้นว่า "เข้าสู่ระบบ" ทั้งที่หน้าเปิดอยู่) ตัวข้อมูลยังไม่รั่วเพราะ API
 * ทุกเส้นตรวจ session อยู่แล้ว แต่ไม่ควรให้หน้าโผล่มาตั้งแต่แรก
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

interface RunResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  elapsedMs: number;
}

/** ฟอร์มที่กำลังแก้อยู่ — แยกจาก ReportDefinition เพราะยังไม่มี id ตอนสร้างใหม่ */
interface Draft {
  id?: string;
  name: string;
  group: string;
  description: string;
  sql: string;
  params: ReportParam[];
}

const EMPTY_DRAFT: Draft = {
  name: "",
  group: "",
  description: "",
  sql: "SELECT ",
  params: [],
};

/** ชื่อที่ใช้แสดงแทนหมวดว่าง — ไม่ได้เก็บลงไฟล์ (ดู UNGROUPED_LABEL ใน store) */
const UNGROUPED = "ไม่ระบุหมวด";

/**
 * จัดรายงานเข้าหมวด เรียงหมวดตามตัวอักษร และดันหมวด "ไม่ระบุหมวด" ไปท้ายสุด
 *
 * ไม่เรียงรายงานภายในหมวดใหม่ ปล่อยตามลำดับในไฟล์ (ลำดับที่สร้าง) เพื่อให้เลขข้อ
 * ของแต่ละใบไม่กระโดดไปมาทุกครั้งที่มีคนแก้ชื่อรายงาน
 */
function groupReports(reports: ReportDefinition[]): { name: string; items: ReportDefinition[] }[] {
  const buckets = new Map<string, ReportDefinition[]>();
  for (const report of reports) {
    const key = (report.group || "").trim() || UNGROUPED;
    const list = buckets.get(key);
    if (list) list.push(report);
    else buckets.set(key, [report]);
  }

  return Array.from(buckets.entries())
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => {
      if (a.name === UNGROUPED) return 1;
      if (b.name === UNGROUPED) return -1;
      return a.name.localeCompare(b.name, "th");
    });
}

/** ตัวอย่างให้กดเริ่มได้เลย ไม่ต้องนั่งนึกโครงสร้างตาราง HOSxP เอง */
const SAMPLE: Draft = {
  name: "ผู้มารับบริการรายวัน",
  description: "จำนวนผู้มารับบริการแยกตามวัน ในช่วงวันที่ที่เลือก",
  group: "งานบริการทั่วไป",
  sql: `SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS วันที่,
       COUNT(*) AS จำนวนครั้ง,
       COUNT(DISTINCT o.hn) AS จำนวนคน
  FROM ovst o
 WHERE o.vstdate BETWEEN :from AND :to
 GROUP BY o.vstdate
 ORDER BY o.vstdate`,
  params: [
    { name: "from", label: "ตั้งแต่วันที่", type: "date", defaultValue: "" },
    { name: "to", label: "ถึงวันที่", type: "date", defaultValue: "" },
  ],
};

export default function ReportsPage({
  loginname,
  hospitalName,
}: {
  loginname: string;
  hospitalName: string;
}) {
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<ReportDefinition | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setError("โหลดรายการรายงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  /** เปิดรายงานขึ้นมาเพื่อรัน — เติมค่าตั้งต้นของพารามิเตอร์ให้ด้วย */
  function openReport(report: ReportDefinition) {
    setSelected(report);
    setDraft(null);
    setResult(null);
    setError("");
    const initial: Record<string, string> = {};
    for (const p of report.params || []) initial[p.name] = p.defaultValue || "";
    setValues(initial);
  }

  function editReport(report: ReportDefinition) {
    setDraft({
      id: report.id,
      name: report.name,
      group: report.group || "",
      description: report.description,
      sql: report.sql,
      params: report.params || [],
    });
    setSelected(null);
    setResult(null);
    setError("");
  }

  async function saveDraft() {
    if (!draft) return;
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setMessage(`บันทึกรายงาน "${data.report.name}" แล้ว`);
      setDraft(null);
      await refresh();
      openReport(data.report);
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    }
  }

  async function removeReport(report: ReportDefinition) {
    if (!confirm(`ลบรายงาน "${report.name}" ใช่หรือไม่`)) return;
    await fetch(`/api/reports?id=${encodeURIComponent(report.id)}`, { method: "DELETE" });
    if (selected?.id === report.id) setSelected(null);
    await refresh();
  }

  /** รันได้ทั้งรายงานที่บันทึกแล้ว และร่างที่ยังไม่ได้บันทึก (ทดลองรัน) */
  async function run(target: "saved" | "draft") {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const body =
        target === "saved"
          ? { id: selected?.id, values }
          : { sql: draft?.sql, params: draft?.params, values };
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "รันรายงานไม่สำเร็จ");
        return;
      }
      setResult(data);
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    } finally {
      setRunning(false);
    }
  }

  async function exportExcel() {
    if (!result || result.rows.length === 0) return;
    const filename = selected?.name || draft?.name || "รายงาน";
    try {
      const res = await fetch("/api/precheck/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, columns: result.columns, rows: result.rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "ส่งออกไฟล์ไม่สำเร็จ");
        return;
      }
      downloadBlob(await res.blob(), `${filename}.xlsx`);
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    }
  }

  function exportBundle(ids?: string[]) {
    const q = ids && ids.length > 0 ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
    window.location.href = `/api/reports/transfer${q}`;
  }

  async function importBundle(file: File) {
    setError("");
    setMessage("");
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await fetch("/api/reports/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "นำเข้าไม่สำเร็จ");
        return;
      }
      const skipped = Array.isArray(data.skipped) ? data.skipped : [];
      setMessage(
        `นำเข้าสำเร็จ ${data.imported} รายงาน` +
          (skipped.length > 0
            ? ` — ข้าม ${skipped.length} รายงานที่ใช้ไม่ได้: ${skipped
                .map((s: any) => `${s.name} (${s.reason})`)
                .join(", ")}`
            : "")
      );
      await refresh();
    } catch {
      setError("อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .json ที่ส่งออกจาก NDP-Kit");
    }
  }

  return (
    <Layout title="รายงานที่เขียนเอง" loginname={loginname} hospitalName={hospitalName} fullWidth>
      <h1 className="page-title" style={{ marginBottom: 6 }}>รายงานที่เขียนเอง</h1>
      <p className="brand-subtitle" style={{ margin: "0 0 24px", maxWidth: 820, lineHeight: 1.6 }}>
        เขียนคำสั่ง SELECT เพื่อดึงข้อมูลจากฐาน HOSxP มาแสดงเป็นตาราง ส่งออก Excel ได้
        และส่งไฟล์รายงานให้หน่วยงานอื่นนำไปใช้ต่อได้
      </p>

      {message ? <div className="status-message status-success">{message}</div> : null}
      {error ? <div className="status-message status-error">{error}</div> : null}

      {/* ---- รายการรายงาน ----
          วางไว้บนสุดเพราะงานที่ทำบ่อยที่สุดคือ "เปิดรายงานที่มีอยู่แล้ว" ไม่ใช่การสร้างใหม่
          ปุ่มสร้าง/นำเข้าจึงย้ายไปอยู่ใต้รายการ */}
      {loading ? (
        <p>กำลังโหลด...</p>
      ) : reports.length === 0 ? (
        <div className="add-item-card" style={{ padding: "24px 22px", marginBottom: 24 }}>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            ยังไม่มีรายงาน — กด <strong>สร้างรายงานใหม่</strong> ด้านล่างเพื่อเขียนเอง
            หรือ <strong>เริ่มจากตัวอย่าง</strong> เพื่อดูโครงคำสั่งก่อน
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {groupReports(reports).map((group) => (
            <div key={group.name} style={{ marginBottom: 22 }}>
              <h2 className="section-title" style={{ marginBottom: 10 }}>
                {group.name}{" "}
                <span className="card-id">({group.items.length} รายงาน)</span>
              </h2>
              <div className="card-list" style={{ gap: 14 }}>
                {group.items.map((report, index) => (
                  // ทั้งใบกดเปิดรายงานได้ เพราะเป็นสิ่งที่คนกดบ่อยที่สุด ไม่ต้องเล็งปุ่มเล็กๆ
                  // ปุ่มด้านขวาต้อง stopPropagation ไม่งั้นกด "ลบ" แล้วจะเปิดรายงานตามไปด้วย
                  <div
                    className="card report-card"
                    key={report.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openReport(report)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openReport(report);
                      }
                    }}
                  >
                    <div className="card-header" style={{ marginBottom: 0, alignItems: "flex-start" }}>
                      <div>
                        {/* เลขนับแยกในแต่ละหมวด แบบเดียวกับแท็บในหน้าตรวจก่อนส่งเคลม
                            เพื่อให้อ้างกันได้ว่า "หมวดนั้นข้อ 3" โดยไม่ต้องนับรวมทั้งหน้า */}
                        <span className="report-no">{index + 1}</span>
                        <strong style={{ fontSize: "1.05rem" }}>{report.name}</strong>
                        {report.source === "imported" ? (
                          <span className="status-pill status-warn" style={{ marginLeft: 8 }}>
                            รับมาจากหน่วยอื่น
                          </span>
                        ) : null}
                        {report.description ? (
                          <p className="brand-subtitle" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>
                            {report.description}
                          </p>
                        ) : null}
                        {report.author ? (
                          <p className="brand-subtitle" style={{ margin: "6px 0 0", fontSize: 12 }}>
                            ผู้เขียน: {report.author}
                          </p>
                        ) : null}
                      </div>
                      <div className="toolbar" style={{ margin: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button className="button-primary" onClick={() => openReport(report)}>เปิดรายงาน</button>
                        <button className="button-ghost" onClick={() => editReport(report)}>แก้ไข</button>
                        <button className="button-ghost" onClick={() => exportBundle([report.id])}>ส่งออกไฟล์</button>
                        <button className="button-ghost" onClick={() => void removeReport(report)}>ลบ</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button className="button-primary" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setSelected(null); setResult(null); }}>
          + สร้างรายงานใหม่
        </button>
        <button className="button-ghost" onClick={() => { setDraft({ ...SAMPLE }); setSelected(null); setResult(null); }}>
          เริ่มจากตัวอย่าง
        </button>
        <button className="button-ghost" onClick={() => fileInput.current?.click()}>
          นำเข้าไฟล์รายงาน
        </button>
        <button className="button-ghost" onClick={() => exportBundle()} disabled={reports.length === 0}>
          ส่งออกรายงานทั้งหมด
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importBundle(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* ---- ตัวเขียนรายงาน ---- */}
      {draft ? (
        <section style={{ marginTop: 32 }}>
          <h2 className="section-title">{draft.id ? "แก้ไขรายงาน" : "สร้างรายงานใหม่"}</h2>
          <div className="add-item-card">
            <div className="label-group">
              <label>ชื่อรายงาน</label>
              <input
                className="input-field"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="label-group" style={{ marginTop: 12 }}>
              <label>หมวด (เว้นว่างได้ — ใช้จัดกลุ่มในหน้ารายการ)</label>
              {/* พิมพ์หมวดใหม่ได้อิสระ แต่เลือกจากหมวดที่เคยใช้แล้วได้ด้วย
                  กันพิมพ์ไม่ตรงกันจนกลายเป็นคนละหมวด เช่น "งาน ANC" กับ "งานANC" */}
              <input
                className="input-field"
                list="report-groups"
                placeholder="เช่น งานส่งเสริมป้องกัน"
                value={draft.group}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
              />
              <datalist id="report-groups">
                {Array.from(new Set(reports.map((r) => (r.group || "").trim()).filter(Boolean))).map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="label-group" style={{ marginTop: 12 }}>
              <label>คำอธิบาย</label>
              <input
                className="input-field"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <div className="label-group" style={{ marginTop: 12 }}>
              <label>คำสั่ง SQL (SELECT เท่านั้น — อ้างพารามิเตอร์ด้วย :ชื่อ)</label>
              <textarea
                className="input-field"
                style={{ minHeight: 220, fontFamily: "Consolas, monospace", whiteSpace: "pre" }}
                spellCheck={false}
                value={draft.sql}
                onChange={(e) => setDraft({ ...draft, sql: e.target.value })}
              />
            </div>

            <ParamEditor
              params={draft.params}
              onChange={(params) => setDraft({ ...draft, params })}
            />

            {draft.params.length > 0 ? (
              <ParamInputs params={draft.params} values={values} onChange={setValues} />
            ) : null}

            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="button-primary" onClick={() => void run("draft")} disabled={running}>
                {running ? "กำลังรัน..." : "ทดลองรัน"}
              </button>
              <button className="button-primary" onClick={() => void saveDraft()}>บันทึกรายงาน</button>
              <button className="button-ghost" onClick={() => { setDraft(null); setResult(null); }}>ยกเลิก</button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- หน้ารันรายงานที่บันทึกไว้ ---- */}
      {selected ? (
        <section style={{ marginTop: 32 }}>
          <h2 className="section-title">{selected.name}</h2>
          <div className="add-item-card">
            {selected.source === "imported" ? (
              <div className="state-warn" style={{ marginTop: 0 }}>
                รายงานนี้รับมาจากหน่วยงานอื่น — ควรอ่านคำสั่งด้านล่างให้เข้าใจก่อนรัน
                ระบบกันคำสั่งที่แก้ไขหรือทำลายข้อมูลให้แล้ว แต่คำสั่งที่ปลอดภัยก็ยังดึงข้อมูลผู้ป่วยออกมาได้
              </div>
            ) : null}

            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>ดูคำสั่ง SQL ของรายงานนี้</summary>
              <pre className="sql-block">{selected.sql}</pre>
            </details>

            {selected.params.length > 0 ? (
              <ParamInputs params={selected.params} values={values} onChange={setValues} />
            ) : null}

            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="button-primary" onClick={() => void run("saved")} disabled={running}>
                {running ? "กำลังรัน..." : "รันรายงาน"}
              </button>
              <button className="button-ghost" onClick={() => void exportExcel()} disabled={!result || result.rows.length === 0}>
                ส่งออก Excel
              </button>
              <button className="button-ghost" onClick={() => { setSelected(null); setResult(null); }}>ปิด</button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- ผลลัพธ์ ---- */}
      {result ? (
        <section style={{ marginTop: 32 }}>
          <h2 className="section-title">
            ผลลัพธ์ ({result.rows.length.toLocaleString()} แถว · {result.elapsedMs.toLocaleString()} ms)
          </h2>
          {result.truncated ? (
            <div className="state-warn">
              ผลลัพธ์มากเกินกำหนด ระบบแสดงเท่าที่รับไหว — กรองช่วงข้อมูลให้แคบลงเพื่อดูให้ครบ
            </div>
          ) : null}
          {draft ? (
            <div className="toolbar">
              <button className="button-ghost" onClick={() => void exportExcel()} disabled={result.rows.length === 0}>
                ส่งออก Excel
              </button>
            </div>
          ) : null}
          {result.rows.length === 0 ? (
            <p>ไม่พบข้อมูลตามเงื่อนไขที่ระบุ</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c.key}>{String(row[c.key] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </Layout>
  );
}

/** ตัวจัดการรายการพารามิเตอร์ของรายงาน (ตอนเขียน) */
function ParamEditor({
  params,
  onChange,
}: {
  params: ReportParam[];
  onChange: (params: ReportParam[]) => void;
}) {
  function update(index: number, patch: Partial<ReportParam>) {
    onChange(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label style={{ fontWeight: 600 }}>พารามิเตอร์ (ช่องให้ผู้ใช้กรอกก่อนรัน)</label>
      <p className="brand-subtitle" style={{ margin: "4px 0 8px", fontSize: 12 }}>
        ประกาศไว้ที่นี่แล้วอ้างในคำสั่งด้วย <code>:ชื่อ</code> เช่น <code>WHERE vstdate BETWEEN :from AND :to</code>
        — ค่าที่กรอกจะถูกส่งแบบผูกค่า ไม่ได้ต่อเป็นข้อความ จึงแทรกคำสั่งเพิ่มไม่ได้
      </p>
      {params.map((p, i) => (
        <div className="form-row" key={i} style={{ marginBottom: 8 }}>
          <div className="label-group">
            <label>ชื่อ (ใช้ใน SQL)</label>
            <input className="input-field" value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
          </div>
          <div className="label-group">
            <label>ป้ายที่แสดง</label>
            <input className="input-field" value={p.label} onChange={(e) => update(i, { label: e.target.value })} />
          </div>
          <div className="label-group">
            <label>ชนิด</label>
            <select
              className="input-field"
              value={p.type}
              onChange={(e) => update(i, { type: e.target.value as ReportParamType })}
            >
              <option value="date">วันที่</option>
              <option value="text">ข้อความ</option>
              <option value="number">ตัวเลข</option>
            </select>
          </div>
          <div className="label-group" style={{ justifyContent: "flex-end" }}>
            <button className="button-ghost" onClick={() => onChange(params.filter((_, j) => j !== i))}>
              ลบ
            </button>
          </div>
        </div>
      ))}
      <button
        className="button-ghost"
        onClick={() => onChange([...params, { name: "", label: "", type: "text", defaultValue: "" }])}
      >
        + เพิ่มพารามิเตอร์
      </button>
    </div>
  );
}

/** ช่องกรอกค่าพารามิเตอร์ก่อนรัน */
function ParamInputs({
  params,
  values,
  onChange,
}: {
  params: ReportParam[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return (
    <div className="grid-form" style={{ marginTop: 16 }}>
      <div className="form-row">
        {params.map((p) => (
          <div className="label-group" key={p.name}>
            <label>{p.label || p.name}</label>
            <input
              className="input-field"
              type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"}
              value={values[p.name] ?? ""}
              onChange={(e) => onChange({ ...values, [p.name]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
