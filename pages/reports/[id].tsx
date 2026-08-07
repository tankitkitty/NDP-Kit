import { GetServerSideProps } from "next";
import Link from "next/link";
import { useState } from "react";
import Layout from "../../components/Layout";
import { getHospitalName } from "../../lib/db";
import { findReport } from "../../lib/reports/registry";
import { getSession } from "../../lib/session";
import { isAdminMode } from "../../lib/reports/admin";
import { ReportDefinition, ReportParam } from "../../lib/reports/types";

interface RunResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  elapsedMs: number;
}

/**
 * หน้ารันรายงานทีละใบ — แยกออกมาจากหน้ารวมรายงาน
 *
 * เดิมผลลัพธ์ต่อท้ายอยู่ใต้รายการรายงานในหน้าเดียวกัน ซึ่งพอข้อมูลเยอะจะต้องเลื่อน
 * ผ่านรายการทั้งหมดกว่าจะถึงตาราง และเปิดรายงานใบใหม่ทีก็ต้องเลื่อนกลับขึ้นไป
 * แยกเป็นคนละหน้าแล้วได้ URL ของตัวเองด้วย จึงบุ๊กมาร์กหรือส่งลิงก์ให้กันได้
 *
 * โหลดตัวรายงานฝั่งเซิร์ฟเวอร์ เพื่อให้เห็นชื่อและคำสั่งทันทีที่หน้าเปิด
 * ไม่ต้องรอเรียก API อีกรอบ (ตัวข้อมูลผลลัพธ์ยังดึงตอนกดรันเหมือนเดิม)
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  // ต้องกันเหมือนหน้ารวม ไม่งั้นเดา URL ของรายงานตรงๆ ก็เปิดได้
  if (!isAdminMode(context.req)) {
    return { redirect: { destination: "/", permanent: false } };
  }

  const id = typeof context.params?.id === "string" ? context.params.id : "";
  const report = findReport(id);
  if (!report) {
    // รายงานถูกลบไปแล้วหรือลิงก์ผิด — ส่งกลับหน้ารวมดีกว่าโชว์หน้าว่าง
    return { redirect: { destination: "/reports", permanent: false } };
  }

  const hospitalName = await getHospitalName();
  return { props: { report, loginname: session.loginname, hospitalName } };
};

export default function ReportRunPage({
  report,
  loginname,
  hospitalName,
}: {
  report: ReportDefinition;
  loginname: string;
  hospitalName: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of report.params || []) initial[p.name] = p.defaultValue || "";
    return initial;
  });
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, values }),
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
    // เติมคอลัมน์ลำดับให้ตรงกับที่เห็นบนจอ (กติกาเดียวกันทั้งโปรเจ็ค)
    const columns = [{ key: "__seq", label: "ลำดับ" }, ...result.columns];
    const rows = result.rows.map((row, i) => ({ ...row, __seq: i + 1 }));
    try {
      const res = await fetch("/api/precheck/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: report.name, columns, rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "ส่งออกไฟล์ไม่สำเร็จ");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    }
  }

  return (
    <Layout title={report.name} loginname={loginname} hospitalName={hospitalName} fullWidth>
      <Link href="/reports" className="button-ghost" style={{ marginBottom: 16, display: "inline-flex" }}>
        ← กลับไปหน้ารวมรายงาน
      </Link>

      <h1 className="page-title" style={{ marginBottom: 6 }}>{report.name}</h1>
      <p className="brand-subtitle" style={{ margin: "0 0 4px", maxWidth: 820, lineHeight: 1.6 }}>
        {report.description || "ไม่มีคำอธิบาย"}
      </p>
      <p className="brand-subtitle" style={{ margin: "0 0 24px", fontSize: 12 }}>
        {report.group ? `หมวด: ${report.group}` : "ไม่ระบุหมวด"}
        {report.author ? ` · ผู้เขียน: ${report.author}` : ""}
      </p>

      <div className="add-item-card">
        {report.id.startsWith("builtin:") ? (
          <div className="state-note" style={{ marginBottom: 14 }}>
            รายงานนี้มากับตัวโปรแกรม ทุกหน่วยบริการได้ชุดเดียวกัน แก้ที่เครื่องนี้ไม่ได้
            ถ้าผลลัพธ์ไม่ตรงกับที่ต้องการให้แจ้งผู้ดูแลเพื่อแก้ในเวอร์ชันถัดไป
          </div>
        ) : report.source === "imported" ? (
          <div className="state-warn" style={{ marginBottom: 14 }}>
            รายงานนี้รับมาจากหน่วยงานอื่น — ควรอ่านคำสั่งด้านล่างให้เข้าใจก่อนรัน
            ระบบกันคำสั่งที่แก้ไขหรือทำลายข้อมูลให้แล้ว แต่คำสั่งที่ปลอดภัยก็ยังดึงข้อมูลผู้ป่วยออกมาได้
          </div>
        ) : null}

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>ดูคำสั่ง SQL ของรายงานนี้</summary>
          <pre className="sql-block">{report.sql}</pre>
        </details>

        {report.params.length > 0 ? (
          <div className="grid-form" style={{ marginTop: 16 }}>
            <div className="form-row">
              {report.params.map((p: ReportParam) => (
                <div className="label-group" key={p.name}>
                  <label>{p.label || p.name}</label>
                  <input
                    className="input-field"
                    type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"}
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="button-primary" onClick={() => void run()} disabled={running}>
            {running ? "กำลังรัน..." : "รันรายงาน"}
          </button>
          <button
            className="button-ghost"
            onClick={() => void exportExcel()}
            disabled={!result || result.rows.length === 0}
          >
            ส่งออก Excel
          </button>
        </div>
      </div>

      {error ? <div className="status-message status-error">{error}</div> : null}

      {result ? (
        <section style={{ marginTop: 32 }}>
          <h2 className="section-title">
            ผลลัพธ์ ({result.rows.length.toLocaleString()} แถว · {result.elapsedMs.toLocaleString()} ms)
          </h2>
          {result.truncated ? (
            <div className="state-warn" style={{ marginBottom: 12 }}>
              ผลลัพธ์มากเกินกำหนด ระบบแสดงเท่าที่รับไหว — กรองช่วงข้อมูลให้แคบลงเพื่อดูให้ครบ
            </div>
          ) : null}
          {result.rows.length === 0 ? (
            <p>ไม่พบข้อมูลตามเงื่อนไขที่ระบุ</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {/* ทุกตารางในโปรเจ็คต้องมีคอลัมน์ลำดับ */}
                    <th className="seq-col">ลำดับ</th>
                    {result.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="seq-col">{i + 1}</td>
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
