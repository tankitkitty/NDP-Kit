import { GetServerSideProps } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import Layout from "../../components/Layout";
import { getHospitalName } from "../../lib/db";
import { getSession } from "../../lib/session";
import { isAdminMode } from "../../lib/reports/admin";

interface InboxRequest {
  fileId: string;
  fileName: string;
  kind: "new" | "revision";
  sender: string;
  hospital: string;
  note: string;
  submittedAt: string;
  name: string;
  group: string;
  description: string;
  sql: string;
  params: { name: string; label: string; type: string; defaultValue?: string }[];
  problems: string[];
}

/**
 * หน้ารับคำขอสร้างรายงานจากผู้ช่วย
 *
 * เปิดได้เฉพาะเครื่องผู้ดูแล เพราะการกดรับคือการเขียนไฟล์ซอร์สโค้ดของโปรแกรม
 * เครื่องหน่วยบริการไม่มีเหตุต้องเห็นหน้านี้
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (!isAdminMode(context.req)) return { redirect: { destination: "/reports", permanent: false } };

  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

export default function ReportInboxPage({
  loginname,
  hospitalName,
}: {
  loginname: string;
  hospitalName: string;
}) {
  const [requests, setRequests] = useState<InboxRequest[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState("");
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/reports/inbox", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "อ่านกล่องรับคำขอไม่สำเร็จ");
        return;
      }
      const list: InboxRequest[] = Array.isArray(data.requests) ? data.requests : [];
      setRequests(list);
      setCanCreate(!!data.canCreate);
      // เติมหมวดที่ผู้ส่งกรอกมาเป็นค่าตั้งต้น ผู้ดูแลแก้ได้ก่อนกดรับ
      const g: Record<string, string> = {};
      for (const r of list) g[r.fileId] = r.group;
      setGroups(g);
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function accept(r: InboxRequest) {
    if (
      !window.confirm(
        `นำ "${r.name}" ไปสร้างเป็นรายงานในระบบ\n\n` +
          `หมวด: ${groups[r.fileId] || "(ไม่ระบุ)"}\n\n` +
          `จะเขียนไฟล์ลงในโค้ดของโปรแกรม และจะถึงมือหน่วยบริการเมื่อปล่อยเวอร์ชันใหม่`
      )
    ) {
      return;
    }
    setBusyId(r.fileId);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/reports/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: r.fileId, fileName: r.fileName, group: groups[r.fileId] || "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "สร้างรายงานไม่สำเร็จ");
        return;
      }
      setMessage(
        `สร้างรายงาน "${r.name}" แล้ว (ไฟล์ ${data.file}) — ` +
          `ลบไฟล์คำขอออกจาก Drive เองได้เลย แล้วปล่อยเวอร์ชันใหม่เพื่อส่งถึงหน่วยบริการ`
      );
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    } finally {
      setBusyId("");
    }
  }

  return (
    <Layout title="คำขอสร้างรายงาน" loginname={loginname} hospitalName={hospitalName} fullWidth>
      <Link href="/reports" className="button-ghost" style={{ marginBottom: 16, display: "inline-flex" }}>
        ← กลับไปหน้ารายงาน
      </Link>

      <div className="reports-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>คำขอสร้างรายงาน</h1>
          <p className="brand-subtitle" style={{ margin: 0, maxWidth: 820, lineHeight: 1.6 }}>
            รายงานที่ผู้ช่วยส่งเข้ามา กดดูรายละเอียด เลือกหมวด แล้วกดนำไปสร้างเป็นรายงานในระบบ
          </p>
        </div>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="button-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "กำลังโหลด..." : "โหลดใหม่"}
          </button>
        </div>
      </div>

      {!canCreate ? (
        <div className="state-warn" style={{ marginBottom: 14 }}>
          เครื่องนี้ไม่ได้รันจากซอร์สโค้ด จึงดูคำขอได้แต่สร้างเป็นรายงานไม่ได้
        </div>
      ) : null}
      {message ? <div className="status-message status-success">{message}</div> : null}
      {error ? <div className="status-message status-error">{error}</div> : null}

      {loading ? (
        <p>กำลังโหลด...</p>
      ) : requests.length === 0 ? (
        <p>ยังไม่มีคำขอเข้ามา</p>
      ) : (
        <div className="report-rows">
          {requests.map((r, i) => (
            <div key={r.fileId}>
              <div
                className="report-row"
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(openId === r.fileId ? "" : r.fileId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(openId === r.fileId ? "" : r.fileId);
                  }
                }}
              >
                <span className="report-no">{i + 1}</span>
                <div className="report-row-text">
                  <span className="report-row-name">{r.name}</span>
                  {r.kind === "revision" ? (
                    <span className="status-pill status-warn">ขอแก้ไขของเดิม</span>
                  ) : null}
                  {r.problems.length > 0 ? (
                    <span className="status-pill status-n">ติด {r.problems.length} ข้อ</span>
                  ) : (
                    <span className="status-pill status-y">ตรวจผ่าน</span>
                  )}
                  <span className="report-row-desc">
                    {r.sender ? `ส่งโดย ${r.sender}` : "ไม่ระบุผู้ส่ง"}
                    {r.hospital ? ` · ${r.hospital}` : ""}
                    {r.submittedAt ? ` · ${new Date(r.submittedAt).toLocaleString("th-TH")}` : ""}
                  </span>
                </div>
              </div>

              {openId === r.fileId ? (
                <div className="add-item-card" style={{ marginTop: 8 }}>
                  {r.problems.length > 0 ? (
                    <div className="state-alert" style={{ marginBottom: 12 }}>
                      <strong>ต้องแก้ก่อนจึงจะสร้างได้</strong>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                        {r.problems.map((p, k) => (
                          <li key={k}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {r.description ? <p style={{ marginTop: 0 }}>{r.description}</p> : null}
                  {r.note ? (
                    <p className="state-note" style={{ marginTop: 0 }}>
                      หมายเหตุจากผู้ส่ง: {r.note}
                    </p>
                  ) : null}

                  <details open>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>คำสั่ง SQL</summary>
                    <pre className="sql-block">{r.sql}</pre>
                  </details>

                  {r.params.length > 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                      พารามิเตอร์: {r.params.map((p) => `${p.label} (:${p.name})`).join(" · ")}
                    </p>
                  ) : null}

                  <div className="grid-form" style={{ marginTop: 12 }}>
                    <div className="form-row">
                      <div className="label-group">
                        <label>หมวดที่จะให้รายงานนี้ไปอยู่</label>
                        <input
                          className="input-field"
                          value={groups[r.fileId] ?? ""}
                          placeholder="เช่น งานส่งเสริมป้องกัน"
                          onChange={(e) => setGroups({ ...groups, [r.fileId]: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="toolbar" style={{ marginTop: 12 }}>
                    <button
                      className="button-primary"
                      onClick={() => void accept(r)}
                      disabled={!canCreate || r.problems.length > 0 || busyId === r.fileId}
                    >
                      {busyId === r.fileId ? "กำลังสร้าง..." : "นำไปสร้างรายงานในระบบ"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
