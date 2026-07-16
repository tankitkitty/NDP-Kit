import { useState } from "react";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import { getCurrentMonthRange } from "../lib/date";
import Layout from "../components/Layout";
import DateField from "../components/DateField";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

const CHECK_INTERVAL_MS = 5000;
const AGENT_BASE_URL = "http://localhost:8189";

type Visit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  cid: string | null;
  patient_name: string | null;
  // สถานะสิทธิที่ HOSxP บันทึกไว้แล้ว (จาก visit_pttype)
  auth_code: string | null;
  pttype: string | null;
  pttype_name: string | null;
  pttype_expire: string | null;
  lastCheck: { status: "success" | "error"; claim_type: string | null; claim_code: string | null; checked_at: string } | null;
};

type RowState = { state: "idle" | "checking" | "success" | "error" | "skipped"; detail?: string };

const DEFAULT_RANGE = getCurrentMonthRange();

function formatDate(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function EligibilityCheck({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [fromDraft, setFromDraft] = useState(DEFAULT_RANGE.start);
  const [toDraft, setToDraft] = useState(DEFAULT_RANGE.end);

  const [hasSearched, setHasSearched] = useState(false);
  const [rows, setRows] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // แก้ไขสิทธิ (visit_pttype) เอง
  type EditForm = {
    vn: string;
    originalPttype: string;
    pttype: string;
    auth_code: string;
    hospmain: string;
    hospsub: string;
    begin_date: string;
    expire_date: string;
    patientName: string;
    pttypeName: string;
  };
  type EditLog = {
    id: number;
    pttype_before: string | null;
    pttype_after: string | null;
    auth_code_before: string | null;
    auth_code_after: string | null;
    edited_by: string | null;
    edited_at: string;
  };
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editHistory, setEditHistory] = useState<EditLog[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  async function fetchVisits() {
    if (!fromDraft || !toDraft) return;
    setLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const params = new URLSearchParams({ from: fromDraft, to: toDraft });
      const res = await fetch(`/api/eligibility-check/visits?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setSelected(new Set());
        setRowState({});
        setHasSearched(true);
        if (data.truncated) {
          setMessage(`พบข้อมูลมากกว่า ${data.rows.length} รายการ แสดงเฉพาะ ${data.rows.length} รายการแรก กรุณาย่อช่วงวันที่`);
          setIsError(false);
        }
      } else {
        setIsError(true);
        setMessage(data.error || "ไม่สามารถโหลดข้อมูลได้");
      }
    } catch {
      setIsError(true);
      setMessage("ไม่สามารถโหลดข้อมูลได้");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(vn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vn)) next.delete(vn);
      else next.add(vn);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.vn));
      if (allSelected) return new Set();
      return new Set(rows.map((r) => r.vn));
    });
  }

  async function runCheck() {
    const targets = rows.filter((r) => selected.has(r.vn));
    if (targets.length === 0) return;

    setChecking(true);
    setMessage(null);
    setIsError(false);
    setProgress({ done: 0, total: targets.length });

    let remaining = Infinity;
    try {
      const qRes = await fetch("/api/eligibility-check/quota");
      const qData = await qRes.json();
      if (qRes.ok) remaining = qData.remaining;
    } catch {
      // ถ้าเช็คโควต้าไม่ได้ ให้ปล่อยผ่านและให้ server ตัดสินใจตอนบันทึกผลแทน
    }

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const nextState: Record<string, RowState> = { ...rowState };

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];

      if (remaining <= 0) {
        nextState[row.vn] = { state: "skipped", detail: "ครบโควต้ารายวัน" };
        skippedCount++;
        setRowState({ ...nextState });
        setProgress({ done: i + 1, total: targets.length });
        continue;
      }

      if (!row.cid) {
        nextState[row.vn] = { state: "error", detail: "ไม่มีเลขบัตรประชาชน" };
        errorCount++;
        setRowState({ ...nextState });
        setProgress({ done: i + 1, total: targets.length });
        continue;
      }

      nextState[row.vn] = { state: "checking" };
      setRowState({ ...nextState });

      const payload: any = {
        vn: row.vn,
        hn: row.hn,
        cid: row.cid,
        patientName: row.patient_name,
        visitDate: row.vstdate,
      };

      try {
        const agentRes = await fetch(`${AGENT_BASE_URL}/api/nhso-service/latest-authen-code/${encodeURIComponent(row.cid)}`);
        if (!agentRes.ok) {
          throw new Error(`Agent ตอบกลับผิดพลาด (HTTP ${agentRes.status})`);
        }
        const raw = await agentRes.json();
        // เผื่อ agent ตอบกลับเป็น array (แบบ latest-5) หรือ body ว่าง
        const data = Array.isArray(raw) ? raw[0] : raw;
        if (!data || (!data.claimCode && !data.claimType)) {
          throw new Error("ไม่พบข้อมูล authen code ของผู้ป่วยรายนี้จาก NHSO");
        }
        payload.status = "success";
        payload.claimType = data.claimType || null;
        payload.claimCode = data.claimCode || null;
        payload.resultHcode = data.hcode || null;
        payload.claimDateTime = data.claimDateTime || null;
        payload.checkDate = data.checkDate || null;
        nextState[row.vn] = {
          state: "success",
          detail: data.claimType ? `${data.claimType}${data.claimCode ? ` (${data.claimCode})` : ""}` : "ตรวจสอบสำเร็จ",
        };
        successCount++;
      } catch (err: any) {
        payload.status = "error";
        payload.errorMessage =
          err?.message === "Failed to fetch"
            ? "ไม่สามารถเชื่อมต่อ NHSO Secure SmartCard Agent ที่เครื่องนี้ (localhost:8189) กรุณาตรวจสอบว่าได้ติดตั้งและเปิด service แล้ว"
            : err?.message || "เกิดข้อผิดพลาดในการตรวจสอบสิทธิ";
        nextState[row.vn] = { state: "error", detail: payload.errorMessage };
        errorCount++;
      }

      setRowState({ ...nextState });
      setProgress({ done: i + 1, total: targets.length });

      try {
        const saveRes = await fetch("/api/eligibility-check/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (saveRes.ok) remaining = Math.max(0, remaining - 1);
      } catch {
        // บันทึกผลไม่สำเร็จ ไม่กระทบลำดับการตรวจสอบต่อไป
      }

      if (i < targets.length - 1) {
        await sleep(CHECK_INTERVAL_MS);
      }
    }

    setChecking(false);
    setIsError(false);
    setMessage(
      `ตรวจสอบเสร็จสิ้น: สำเร็จ ${successCount} รายการ, ผิดพลาด ${errorCount} รายการ` +
        (skippedCount > 0 ? `, ข้าม ${skippedCount} รายการ (ครบโควต้ารายวัน)` : "")
    );
  }

  async function openEdit(row: Visit) {
    if (!row.pttype) {
      setIsError(true);
      setMessage(`VN ${row.vn} ยังไม่มีข้อมูลสิทธิใน HOSxP จึงแก้ไขไม่ได้ (ระบบไม่เพิ่มแถวใหม่)`);
      return;
    }
    setEditLoading(true);
    setEditHistory([]);
    setEditForm({
      vn: row.vn,
      originalPttype: row.pttype,
      pttype: row.pttype,
      auth_code: row.auth_code || "",
      hospmain: "",
      hospsub: "",
      begin_date: "",
      expire_date: row.pttype_expire || "",
      patientName: row.patient_name || "",
      pttypeName: row.pttype_name || "",
    });
    try {
      const params = new URLSearchParams({ vn: row.vn, pttype: row.pttype });
      const res = await fetch(`/api/eligibility-check/pttype?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.row) {
        const r = data.row;
        setEditForm({
          vn: r.vn,
          originalPttype: r.pttype,
          pttype: r.pttype,
          auth_code: r.auth_code || "",
          hospmain: r.hospmain || "",
          hospsub: r.hospsub || "",
          begin_date: r.begin_date || "",
          expire_date: r.expire_date || "",
          patientName: row.patient_name || "",
          pttypeName: r.pttype_name || row.pttype_name || "",
        });
        setEditHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch {
      /* ใช้ค่าเริ่มต้นจากแถวในตารางไปก่อน */
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!editForm) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/eligibility-check/pttype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vn: editForm.vn,
          originalPttype: editForm.originalPttype,
          pttype: editForm.pttype,
          auth_code: editForm.auth_code,
          hospmain: editForm.hospmain,
          hospsub: editForm.hospsub,
          begin_date: editForm.begin_date,
          expire_date: editForm.expire_date,
        }),
      });
      const data = await res.json();
      setIsError(!res.ok);
      setMessage(res.ok ? data.message || "อัปเดตสิทธิใน HOSxP สำเร็จ" : data.error || "ไม่สามารถอัปเดตได้");
      if (res.ok) {
        setEditForm(null);
        fetchVisits();
      }
    } catch {
      setIsError(true);
      setMessage("เกิดข้อผิดพลาดในการอัปเดต");
    } finally {
      setEditSaving(false);
    }
  }

  function autoUpdate(row: Visit) {
    // ปุ่มอัพเดทอัตโนมัติจากผล NHSO — รอเอกสาร/endpoint API ตรวจสอบสิทธิด้วย token (nhso_token)
    setIsError(true);
    setMessage(
      `ยังเปิดใช้งาน "อัพเดทอัตโนมัติ" ไม่ได้ (VN ${row.vn}) — ต้องเชื่อม NHSO API ตรวจสอบสิทธิด้วย token ก่อน กรุณาส่งเอกสาร endpoint API เพื่อเปิดใช้งาน`
    );
  }

  function renderCheckStatus(row: Visit) {
    const live = rowState[row.vn];
    if (live?.state === "checking") return <span className="status-pill status-pending">กำลังตรวจสอบ...</span>;
    if (live?.state === "success") return <span className="status-pill status-y" title={live.detail}>{live.detail}</span>;
    if (live?.state === "error") return <span className="status-pill status-n" title={live.detail}>{live.detail}</span>;
    if (live?.state === "skipped") return <span className="status-pill status-pending">{live.detail}</span>;
    // HOSxP มี auth_code แล้ว = ตรวจสอบสิทธิแล้ว (ถือเป็นสถานะจริงที่เชื่อถือได้)
    if (row.auth_code) {
      const title = `รหัสยืนยันสิทธิ: ${row.auth_code}` + (row.pttype_expire ? ` • หมดอายุ ${formatDate(row.pttype_expire)}` : "");
      return (
        <span className="status-pill status-y" title={title}>
          ตรวจสอบแล้ว
        </span>
      );
    }
    if (row.lastCheck) {
      const pillClass = row.lastCheck.status === "success" ? "status-y" : "status-n";
      const label =
        row.lastCheck.status === "success"
          ? row.lastCheck.claim_type || "ตรวจสอบสำเร็จ"
          : "ตรวจสอบไม่สำเร็จ";
      return (
        <span className={`status-pill ${pillClass}`} title={formatDateTime(row.lastCheck.checked_at)}>
          {label}
        </span>
      );
    }
    return <span className="status-pill status-pending">ยังไม่ตรวจสอบ</span>;
  }

  const canSearch = Boolean(fromDraft && toDraft);
  const selectedCount = selected.size;

  return (
    <Layout title="ระบบตรวจสอบสิทธิ" loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            ระบบตรวจสอบสิทธิ
          </h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 16 }}>
          ดึงรายชื่อผู้ป่วยที่มารับบริการ (OPD) ตามช่วงวันที่ จากฐาน pcu แล้วเลือกส่งตรวจสอบสิทธิผ่าน NHSO Secure SmartCard Agent
        </p>
        <div className="status-message" style={{ marginBottom: 24 }}>
          ระบบนี้เรียกผ่าน <strong>NHSO Secure SmartCard Agent</strong> ที่ต้องติดตั้งและเปิดใช้งานบนเครื่องที่ใช้งานหน้านี้ (เรียกที่ localhost:8189)
          — ระบบจะตรวจสอบให้ห่างกันอย่างน้อย 5 วินาทีต่อรายการ และไม่เกิน 3,000 ครั้งต่อวันโดยอัตโนมัติ
        </div>

        <div className="toolbar" style={{ marginBottom: 24 }}>
          <div className="label-group" style={{ gap: 4 }}>
            <label>วันที่รับบริการตั้งแต่</label>
            <DateField value={fromDraft} max={toDraft || undefined} onChange={setFromDraft} />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>ถึงวันที่</label>
            <DateField value={toDraft} min={fromDraft || undefined} onChange={setToDraft} />
          </div>
          <button className="button-primary" onClick={fetchVisits} disabled={!canSearch || loading} style={{ alignSelf: "flex-end" }}>
            {loading ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
          {rows.length > 0 ? (
            <button
              className="button-primary"
              onClick={runCheck}
              disabled={checking || selectedCount === 0}
              style={{ alignSelf: "flex-end" }}
            >
              {checking
                ? `กำลังตรวจสอบ... (${progress?.done ?? 0}/${progress?.total ?? 0})`
                : `ตรวจสอบสิทธิ (${selectedCount} รายการ)`}
            </button>
          ) : null}
        </div>

        {message ? (
          <div className={`status-message ${isError ? "status-error" : "status-success"}`}>{message}</div>
        ) : null}

        {!hasSearched ? (
          <div className="empty-state">
            <span className="empty-state-icon">📅</span>
            <p style={{ margin: 0, fontWeight: 600 }}>กรุณาเลือกช่วงวันที่รับบริการแล้วกดค้นหา</p>
          </div>
        ) : loading ? (
          <p>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">✅</span>
            <p style={{ margin: 0, fontWeight: 600 }}>ไม่พบข้อมูลผู้ป่วยในช่วงวันที่นี้</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="action-col">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.vn))}
                      onChange={toggleSelectAll}
                      title="เลือกทั้งหมด"
                    />
                  </th>
                  <th>วันที่รับบริการ</th>
                  <th>VN</th>
                  <th>HN</th>
                  <th>ชื่อ-สกุล</th>
                  <th>เลขบัตรประชาชน</th>
                  <th>สิทธิ (HOSxP)</th>
                  <th>ผลตรวจสอบสิทธิ</th>
                  <th>จัดการ (HOSxP)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.vn}>
                    <td className="action-col">
                      <input type="checkbox" checked={selected.has(row.vn)} onChange={() => toggleSelect(row.vn)} />
                    </td>
                    <td>{formatDate(row.vstdate)}</td>
                    <td>{row.vn}</td>
                    <td>{row.hn}</td>
                    <td className="wrap">{row.patient_name || "-"}</td>
                    <td>{row.cid || "-"}</td>
                    <td className="wrap">{row.pttype_name || "-"}</td>
                    <td>{renderCheckStatus(row)}</td>
                    <td>
                      <div className="toolbar" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <button
                          className="button-ghost"
                          style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                          onClick={() => openEdit(row)}
                          disabled={!row.pttype}
                          title={row.pttype ? "แก้ไขสิทธิเองแล้วบันทึกลง HOSxP" : "ไม่มีข้อมูลสิทธิใน HOSxP"}
                        >
                          แก้ไขเอง
                        </button>
                        <button
                          className="button-ghost"
                          style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                          onClick={() => autoUpdate(row)}
                          title="อัพเดทสิทธิลง HOSxP อัตโนมัติจากผล NHSO (ต้องเชื่อม API)"
                        >
                          อัพเดทอัตโนมัติ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editForm ? (
        <div className="modal-backdrop" onClick={() => !editSaving && setEditForm(null)}>
          <div className="modal-card" style={{ maxWidth: 520, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title" style={{ marginTop: 0 }}>แก้ไขสิทธิ (บันทึกลง HOSxP)</h2>
            <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "0.9rem" }}>
              VN {editForm.vn} • {editForm.patientName || "-"}
            </p>
            <div className="grid-form">
              <div className="form-row">
                <div className="label-group">
                  <label>รหัสสิทธิ (pttype)</label>
                  <input
                    className="input-field"
                    value={editForm.pttype}
                    onChange={(e) => setEditForm({ ...editForm, pttype: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>รหัสยืนยันสิทธิ (auth_code)</label>
                  <input
                    className="input-field"
                    value={editForm.auth_code}
                    onChange={(e) => setEditForm({ ...editForm, auth_code: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="label-group">
                  <label>รพ.หลัก (hospmain)</label>
                  <input
                    className="input-field"
                    value={editForm.hospmain}
                    onChange={(e) => setEditForm({ ...editForm, hospmain: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>รพ.รอง (hospsub)</label>
                  <input
                    className="input-field"
                    value={editForm.hospsub}
                    onChange={(e) => setEditForm({ ...editForm, hospsub: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="label-group">
                  <label>วันเริ่มสิทธิ</label>
                  <DateField value={editForm.begin_date} onChange={(v) => setEditForm({ ...editForm, begin_date: v })} />
                </div>
                <div className="label-group">
                  <label>วันหมดอายุสิทธิ</label>
                  <DateField value={editForm.expire_date} onChange={(v) => setEditForm({ ...editForm, expire_date: v })} />
                </div>
              </div>
              {editLoading ? <p style={{ margin: 0, color: "var(--muted)" }}>กำลังโหลดข้อมูลปัจจุบัน...</p> : null}
              <p style={{ margin: "4px 0 0", color: "#b45309", fontSize: "0.85rem" }}>
                ⚠ การบันทึกจะเขียนทับข้อมูลสิทธิใน HOSxP ทันที (ตารางเป็น MyISAM ย้อนกลับไม่ได้) — ระบบจะเก็บ log สำรองค่าเดิมให้อัตโนมัติก่อนบันทึก
              </p>
              {editHistory.length > 0 ? (
                <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 6 }}>
                    ประวัติการแก้ไข (log สำรอง)
                  </div>
                  <div style={{ maxHeight: 120, overflowY: "auto", fontSize: "0.8rem", color: "var(--muted)" }}>
                    {editHistory.map((h) => (
                      <div key={h.id} style={{ padding: "3px 0" }}>
                        {formatDateTime(h.edited_at)} • {h.edited_by || "-"} : สิทธิ {h.pttype_before || "-"}→{h.pttype_after || "-"}, auth {h.auth_code_before || "-"}→{h.auth_code_after || "-"}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 20 }}>
              <button className="button-ghost" onClick={() => setEditForm(null)} disabled={editSaving}>
                ยกเลิก
              </button>
              <button className="button-primary" onClick={saveEdit} disabled={editSaving || editLoading}>
                {editSaving ? "กำลังบันทึก..." : "บันทึกลง HOSxP"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
