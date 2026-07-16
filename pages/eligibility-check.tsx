import { useMemo, useState } from "react";
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

type Visit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  cid: string | null;
  patient_name: string | null;
  // สิทธิที่ HOSxP บันทึกไว้แล้ว (จาก visit_pttype) — ไม่ต้องใช้ agent/บัตร
  auth_code: string | null;
  pttype: string | null;
  pttype_name: string | null;
  pttype_expire: string | null;
};

type StatusFilter = "all" | "checked" | "unchecked";

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

// เว้นระยะการตรวจสอบสิทธิสดอย่างน้อย 5 วินาที/รายการ ตามข้อกำหนด
const VERIFY_INTERVAL_MS = 5000;

type VerifyState = { state: "checking" | "ok" | "fail"; message: string };

export default function EligibilityCheck({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [fromDraft, setFromDraft] = useState(DEFAULT_RANGE.start);
  const [toDraft, setToDraft] = useState(DEFAULT_RANGE.end);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [hasSearched, setHasSearched] = useState(false);
  const [rows, setRows] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

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

  // ตรวจสอบสิทธิสด (online ด้วย token) — เลือกเป็นรายคน ยังไม่บันทึกลง HOSxP
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [verifyResult, setVerifyResult] = useState<Record<string, VerifyState>>({});
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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
        setVerifyResult({});
        setHasSearched(true);
        if (data.truncated) {
          setIsError(false);
          setMessage(`พบข้อมูลมากกว่า ${data.rows.length} รายการ แสดงเฉพาะ ${data.rows.length} รายการแรก กรุณาย่อช่วงวันที่`);
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

  function toggleSelect(vn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vn)) next.delete(vn);
      else next.add(vn);
      return next;
    });
  }

  function toggleSelectAll(list: Visit[]) {
    setSelected((prev) => {
      const allSelected = list.length > 0 && list.every((r) => prev.has(r.vn));
      if (allSelected) return new Set();
      return new Set(list.map((r) => r.vn));
    });
  }

  // ตรวจสอบสิทธิสดกับ NHSO online (ทีละคน เว้น 5 วิ) — แสดงผลอย่างเดียว ยังไม่เขียนลง HOSxP
  async function runVerify() {
    const targets = rows.filter((r) => selected.has(r.vn));
    if (targets.length === 0) return;
    setVerifying(true);
    setMessage(null);
    setIsError(false);
    setProgress({ done: 0, total: targets.length });
    const results: Record<string, VerifyState> = { ...verifyResult };

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (!row.cid) {
        results[row.vn] = { state: "fail", message: "ไม่มีเลขบัตรประชาชน" };
        setVerifyResult({ ...results });
        setProgress({ done: i + 1, total: targets.length });
        continue;
      }
      results[row.vn] = { state: "checking", message: "กำลังตรวจสอบ..." };
      setVerifyResult({ ...results });
      try {
        const res = await fetch("/api/eligibility-check/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid: row.cid }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          results[row.vn] = { state: "ok", message: "ตรวจสอบสำเร็จ" };
        } else {
          results[row.vn] = { state: "fail", message: data.message || data.error || "ตรวจสอบไม่สำเร็จ" };
        }
      } catch {
        results[row.vn] = { state: "fail", message: "เกิดข้อผิดพลาดในการเรียก" };
      }
      setVerifyResult({ ...results });
      setProgress({ done: i + 1, total: targets.length });
      if (i < targets.length - 1) await sleep(VERIFY_INTERVAL_MS);
    }
    setVerifying(false);
  }

  function renderVerify(row: Visit) {
    const v = verifyResult[row.vn];
    if (!v) return <span style={{ color: "var(--muted)" }}>-</span>;
    if (v.state === "checking") return <span className="status-pill status-pending">กำลังตรวจสอบ...</span>;
    if (v.state === "ok") return <span className="status-pill status-y" title={v.message}>ตรวจสอบสำเร็จ</span>;
    return <span className="status-pill status-n" title={v.message}>{v.message}</span>;
  }

  function renderStatus(row: Visit) {
    if (row.auth_code) {
      const title = `รหัสยืนยันสิทธิ: ${row.auth_code}` + (row.pttype_expire ? ` • หมดอายุ ${formatDate(row.pttype_expire)}` : "");
      return (
        <span className="status-pill status-y" title={title}>
          ตรวจสอบแล้ว
        </span>
      );
    }
    return <span className="status-pill status-pending">ยังไม่ตรวจสอบ</span>;
  }

  const filteredRows = useMemo(() => {
    if (statusFilter === "checked") return rows.filter((r) => r.auth_code);
    if (statusFilter === "unchecked") return rows.filter((r) => !r.auth_code);
    return rows;
  }, [rows, statusFilter]);

  const checkedCount = useMemo(() => rows.filter((r) => r.auth_code).length, [rows]);
  const canSearch = Boolean(fromDraft && toDraft);

  return (
    <Layout title="ตรวจสอบสิทธิ" loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            ตรวจสอบสิทธิคนไข้
          </h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 20 }}>
          ดึงคนไข้ที่มารับบริการ (OPD) ตามช่วงวันที่ แสดงสิทธิที่บันทึกไว้ในระบบ HOSxP (visit_pttype) พร้อมสถานะว่าตรวจสอบสิทธิแล้วหรือยัง — แก้ไขสิทธิลง HOSxP ได้เอง (ไม่ต้องใช้เครื่องอ่านบัตร/agent)
        </p>

        <div className="toolbar" style={{ marginBottom: 20 }}>
          <div className="label-group" style={{ gap: 4 }}>
            <label>วันที่รับบริการตั้งแต่</label>
            <DateField value={fromDraft} max={toDraft || undefined} onChange={setFromDraft} />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>ถึงวันที่</label>
            <DateField value={toDraft} min={fromDraft || undefined} onChange={setToDraft} />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>สถานะสิทธิ</label>
            <select className="input-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">ทั้งหมด</option>
              <option value="checked">ตรวจสอบแล้ว</option>
              <option value="unchecked">ยังไม่ตรวจสอบ</option>
            </select>
          </div>
          <button className="button-primary" onClick={fetchVisits} disabled={!canSearch || loading} style={{ alignSelf: "flex-end" }}>
            {loading ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
          {rows.length > 0 ? (
            <button
              className="button-primary"
              onClick={runVerify}
              disabled={verifying || selected.size === 0}
              style={{ alignSelf: "flex-end" }}
              title="ตรวจสอบสิทธิสดกับ NHSO (online ด้วย token) — ยังไม่บันทึกลง HOSxP"
            >
              {verifying ? `กำลังตรวจสอบ... (${progress?.done ?? 0}/${progress?.total ?? 0})` : `ตรวจสอบสิทธิ (${selected.size} ราย)`}
            </button>
          ) : null}
        </div>

        {message ? <div className={`status-message ${isError ? "status-error" : "status-success"}`}>{message}</div> : null}

        {!hasSearched ? (
          <div className="empty-state">
            <p style={{ margin: 0, fontWeight: 600 }}>กรุณาเลือกช่วงวันที่รับบริการแล้วกดค้นหา</p>
          </div>
        ) : loading ? (
          <p>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0, fontWeight: 600 }}>ไม่พบข้อมูลผู้ป่วยในช่วงวันที่นี้</p>
          </div>
        ) : (
          <>
            <div className="status-message" style={{ marginTop: 0, marginBottom: 16 }}>
              ทั้งหมด {rows.length} ราย • ตรวจสอบแล้ว {checkedCount} ราย • ยังไม่ตรวจสอบ {rows.length - checkedCount} ราย
              {statusFilter !== "all" ? ` (แสดง ${filteredRows.length} ราย)` : ""}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="action-col">
                      <input
                        type="checkbox"
                        checked={filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.vn))}
                        onChange={() => toggleSelectAll(filteredRows)}
                        title="เลือกทั้งหมด"
                      />
                    </th>
                    <th>วันที่รับบริการ</th>
                    <th>VN</th>
                    <th>HN</th>
                    <th>ชื่อ-สกุล</th>
                    <th>เลขบัตรประชาชน</th>
                    <th>สิทธิ (HOSxP)</th>
                    <th>สถานะ</th>
                    <th>ผลตรวจสด (NHSO)</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
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
                      <td>{renderStatus(row)}</td>
                      <td>{renderVerify(row)}</td>
                      <td>
                        <button
                          className="button-ghost"
                          style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                          onClick={() => openEdit(row)}
                          disabled={!row.pttype}
                          title={row.pttype ? "แก้ไขสิทธิเองแล้วบันทึกลง HOSxP" : "ไม่มีข้อมูลสิทธิใน HOSxP"}
                        >
                          แก้ไขเอง
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
                  <input className="input-field" value={editForm.pttype} onChange={(e) => setEditForm({ ...editForm, pttype: e.target.value })} />
                </div>
                <div className="label-group">
                  <label>รหัสยืนยันสิทธิ (auth_code)</label>
                  <input className="input-field" value={editForm.auth_code} onChange={(e) => setEditForm({ ...editForm, auth_code: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="label-group">
                  <label>รพ.หลัก (hospmain)</label>
                  <input className="input-field" value={editForm.hospmain} onChange={(e) => setEditForm({ ...editForm, hospmain: e.target.value })} />
                </div>
                <div className="label-group">
                  <label>รพ.รอง (hospsub)</label>
                  <input className="input-field" value={editForm.hospsub} onChange={(e) => setEditForm({ ...editForm, hospsub: e.target.value })} />
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
              <p style={{ margin: "4px 0 0", color: "#b45309", fontSize: "0.85rem" }}>
                ⚠ การบันทึกจะเขียนทับข้อมูลสิทธิใน HOSxP ทันที (ตารางเป็น MyISAM ย้อนกลับไม่ได้) — ระบบเก็บ log สำรองค่าเดิมให้อัตโนมัติก่อนบันทึก
              </p>
              {editHistory.length > 0 ? (
                <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 6 }}>ประวัติการแก้ไข (log สำรอง)</div>
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
