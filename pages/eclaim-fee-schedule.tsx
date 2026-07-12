import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getCurrentMonthRange } from "../lib/date";
import { getHospitalName } from "../lib/db";
import Layout from "../components/Layout";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALUES: Status[] = ["N", "Y", "C", "null", "all"];

type Row = Record<string, any>;

type Counts = { N: number; Y: number; C: number; null: number; all: number };

type Status = "N" | "Y" | "C" | "null" | "all";

const TABS: { key: Status; label: string }[] = [
  { key: "N", label: "ไม่สำเร็จ" },
  { key: "Y", label: "สำเร็จ" },
  { key: "C", label: "ยกเลิก" },
  { key: "null", label: "ยังไม่ส่ง" },
  { key: "all", label: "ทั้งหมด" },
];

type ColumnType = "date" | "status" | "longtext";

const COLUMNS: { key: string; label: string; type?: ColumnType }[] = [
  { key: "eclaim_fee_schedule_id", label: "ID" },
  { key: "vn", label: "VN" },
  { key: "hn", label: "HN" },
  { key: "patient_name", label: "ชื่อผู้ป่วย" },
  { key: "eclaim_fee_schedule_req_date", label: "วันที่ส่งเคลม", type: "date" },
  { key: "eclaim_fee_schedule_status", label: "สถานะ", type: "status" },
  { key: "claim_staff", label: "ผู้บันทึก" },
  { key: "last_update", label: "แก้ไขล่าสุด", type: "date" },
  { key: "nhso_id", label: "NHSO ID" },
  { key: "nhso_seq", label: "NHSO Seq" },
  { key: "nhso_uid", label: "NHSO UID" },
  { key: "nhso_record_status", label: "NHSO Record Status" },
  { key: "nhso_payment_status", label: "NHSO Payment Status" },
  { key: "nhso_run_date", label: "NHSO Run Date", type: "date" },
  { key: "nhso_budget_no", label: "NHSO Budget No" },
  { key: "nhso_book_date", label: "NHSO Book Date", type: "date" },
  { key: "nhso_doc_no", label: "NHSO Doc No" },
  { key: "nhso_rep_no", label: "NHSO Rep No" },
  { key: "nhso_period", label: "NHSO Period" },
  { key: "nhso_message", label: "NHSO Message", type: "longtext" },
  { key: "nhso_btch_no", label: "NHSO Batch No" },
  { key: "nhso_source_channel", label: "NHSO Source Channel" },
  { key: "rep_eclaim_detail_rep_no", label: "Rep No" },
  { key: "rep_eclaim_detail_error_code", label: "Error Code", type: "longtext" },
  { key: "eclaim_fee_schedule_check_req", label: "Check Request", type: "longtext" },
  { key: "eclaim_fee_schedule_req", label: "Request (Raw)", type: "longtext" },
  { key: "eclaim_fee_schedule_resp", label: "Response (Raw)", type: "longtext" },
];

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

function formatDate(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderStatusPill(status: string | null) {
  if (status === "N") return <span className="status-pill status-n">ไม่สำเร็จ</span>;
  if (status === "Y") return <span className="status-pill status-y">สำเร็จ</span>;
  if (status === "C") return <span className="status-pill status-n">ยกเลิก</span>;
  return <span className="status-pill status-pending">ยังไม่ส่ง</span>;
}

const DEFAULT_RANGE = getCurrentMonthRange();

export default function EclaimFeeSchedule({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const router = useRouter();

  const [statusDraft, setStatusDraft] = useState<Status>("all");
  const [fromDraft, setFromDraft] = useState(DEFAULT_RANGE.start);
  const [toDraft, setToDraft] = useState(DEFAULT_RANGE.end);

  const [status, setStatus] = useState<Status>("all");
  const [fromDate, setFromDate] = useState(DEFAULT_RANGE.start);
  const [toDate, setToDate] = useState(DEFAULT_RANGE.end);
  const [page, setPage] = useState(1);

  const [hasSearched, setHasSearched] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [counts, setCounts] = useState<Counts>({ N: 0, Y: 0, C: 0, null: 0, all: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [syncingNhso, setSyncingNhso] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [columnFilterDrafts, setColumnFilterDrafts] = useState<Record<string, string>>({});
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("vn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  type Query = {
    status: Status;
    from: string;
    to: string;
    page: number;
    filters: Record<string, string>;
    sortKey: string;
    sortDir: "asc" | "desc";
  };

  function syncUrl(params: Query) {
    const query: Record<string, string> = {
      status: params.status,
      from: params.from,
      to: params.to,
      page: String(params.page),
      sort: params.sortKey,
      dir: params.sortDir,
    };
    if (Object.keys(params.filters).length > 0) {
      query.filters = JSON.stringify(params.filters);
    }
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }

  useEffect(() => {
    if (!router.isReady) return;

    const q = router.query;
    const qStatus = typeof q.status === "string" && STATUS_VALUES.includes(q.status as Status) ? (q.status as Status) : "all";
    const qFrom = typeof q.from === "string" && DATE_PATTERN.test(q.from) ? q.from : DEFAULT_RANGE.start;
    const qTo = typeof q.to === "string" && DATE_PATTERN.test(q.to) ? q.to : DEFAULT_RANGE.end;
    const qPage = Number(q.page) > 0 ? Number(q.page) : 1;
    const qSortKey = typeof q.sort === "string" ? q.sort : "vn";
    const qSortDir = q.dir === "asc" ? "asc" : "desc";
    let qFilters: Record<string, string> = {};
    if (typeof q.filters === "string") {
      try {
        qFilters = JSON.parse(q.filters);
      } catch {
        qFilters = {};
      }
    }

    setStatusDraft(qStatus);
    setFromDraft(qFrom);
    setToDraft(qTo);
    setStatus(qStatus);
    setFromDate(qFrom);
    setToDate(qTo);
    setPage(qPage);
    setSortKey(qSortKey);
    setSortDir(qSortDir);
    setColumnFilterDrafts(qFilters);
    setColumnFilters(qFilters);
    setHasSearched(true);
    fetchRows({ status: qStatus, from: qFrom, to: qTo, page: qPage, filters: qFilters, sortKey: qSortKey, sortDir: qSortDir });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  async function fetchRows(overrides?: Partial<Query>) {
    const effStatus = overrides?.status ?? status;
    const effFrom = overrides?.from ?? fromDate;
    const effTo = overrides?.to ?? toDate;
    const effPage = overrides?.page ?? page;
    const effFilters = overrides?.filters ?? columnFilters;
    const effSortKey = overrides?.sortKey ?? sortKey;
    const effSortDir = overrides?.sortDir ?? sortDir;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: effStatus,
        page: String(effPage),
        sort: effSortKey,
        dir: effSortDir,
      });
      if (effFrom) params.set("from", effFrom);
      if (effTo) params.set("to", effTo);
      if (Object.keys(effFilters).length > 0) params.set("filters", JSON.stringify(effFilters));
      const res = await fetch(`/api/eclaim-fee-schedule?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setPageSize(data.pageSize || 50);
        setCounts(data.counts || { N: 0, Y: 0, C: 0, null: 0, all: 0 });
        setSelectedIds(new Set());
      } else {
        setMessage(data.error || "ไม่สามารถโหลดข้อมูลได้");
      }
    } catch (error) {
      setMessage("ไม่สามารถโหลดข้อมูลได้");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    if (!fromDraft || !toDraft) return;
    const activeFilters = Object.fromEntries(Object.entries(columnFilterDrafts).filter(([, v]) => v.trim()));
    setStatus(statusDraft);
    setFromDate(fromDraft);
    setToDate(toDraft);
    setColumnFilters(activeFilters);
    setPage(1);
    setHasSearched(true);
    setMessage(null);
    fetchRows({ status: statusDraft, from: fromDraft, to: toDraft, page: 1, filters: activeFilters });
    syncUrl({ status: statusDraft, from: fromDraft, to: toDraft, page: 1, filters: activeFilters, sortKey, sortDir });
  }

  function clearFilters() {
    setStatusDraft("all");
    setFromDraft(DEFAULT_RANGE.start);
    setToDraft(DEFAULT_RANGE.end);
    setStatus("all");
    setFromDate(DEFAULT_RANGE.start);
    setToDate(DEFAULT_RANGE.end);
    setColumnFilterDrafts({});
    setColumnFilters({});
    setSortKey("vn");
    setSortDir("desc");
    setPage(1);
    setHasSearched(true);
    setMessage(null);
    fetchRows({
      status: "all",
      from: DEFAULT_RANGE.start,
      to: DEFAULT_RANGE.end,
      page: 1,
      filters: {},
      sortKey: "vn",
      sortDir: "desc",
    });
    syncUrl({
      status: "all",
      from: DEFAULT_RANGE.start,
      to: DEFAULT_RANGE.end,
      page: 1,
      filters: {},
      sortKey: "vn",
      sortDir: "desc",
    });
  }

  function clearColumnFilters() {
    setColumnFilterDrafts({});
    setColumnFilters({});
    setPage(1);
    setMessage(null);
    fetchRows({ filters: {}, page: 1 });
    syncUrl({ status, from: fromDate, to: toDate, page: 1, filters: {}, sortKey, sortDir });
  }

  function goToPage(next: number) {
    const clamped = Math.max(1, Math.min(totalPages, next));
    setPage(clamped);
    fetchRows({ page: clamped });
    syncUrl({ status, from: fromDate, to: toDate, page: clamped, filters: columnFilters, sortKey, sortDir });
  }

  function handleSort(key: string) {
    const nextDir: "asc" | "desc" = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    setSortKey(key);
    setSortDir(nextDir);
    setPage(1);
    fetchRows({ sortKey: key, sortDir: nextDir, page: 1 });
    syncUrl({ status, from: fromDate, to: toDate, page: 1, filters: columnFilters, sortKey: key, sortDir: nextDir });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.eclaim_fee_schedule_id;
    setDeletingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/eclaim-fee-schedule/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "ลบข้อมูลสำเร็จ");
        fetchRows();
      } else {
        setMessage(data.error || "ไม่สามารถลบข้อมูลได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการลบข้อมูล");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((row) => prev.has(row.eclaim_fee_schedule_id));
      if (allSelected) return new Set();
      return new Set(rows.map((row) => row.eclaim_fee_schedule_id));
    });
  }

  async function handleNhsoSync() {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : rows.map((row) => row.eclaim_fee_schedule_id);
    if (ids.length === 0) return;
    setSyncingNhso(true);
    setMessage(null);
    try {
      const res = await fetch("/api/eclaim-fee-schedule/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "ซิงค์สำเร็จ");
        fetchRows();
      } else {
        setMessage(data.error || "ไม่สามารถซิงค์ข้อมูลได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการซิงค์ข้อมูล");
    } finally {
      setSyncingNhso(false);
    }
  }

  const canSearch = Boolean(fromDraft && toDraft);
  const hasActiveFilters = hasSearched && (fromDate || toDate || status !== "all");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isError = message ? /ไม่สามารถ|ผิดพลาด/.test(message) : false;

  return (
    <Layout title="ตรวจสอบ eClaim Fee Schedule" loginname={loginname} hospitalName={hospitalName} fullWidth>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            ตรวจสอบและแก้ไขข้อมูล eClaim Fee Schedule
          </h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 24 }}>
          ข้อมูลการส่งเคลม Fee Schedule ไปยัง NHSO (ตาราง eclaim_fee_schedule)
        </p>

        <div className="toolbar" style={{ marginBottom: 24 }}>
          <div className="label-group" style={{ gap: 4 }}>
            <label>วันที่ส่งเคลมตั้งแต่</label>
            <input
              className="input-field"
              type="date"
              lang="th"
              value={fromDraft}
              max={toDraft || undefined}
              onChange={(e) => setFromDraft(e.target.value)}
            />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>ถึงวันที่</label>
            <input
              className="input-field"
              type="date"
              lang="th"
              value={toDraft}
              min={fromDraft || undefined}
              onChange={(e) => setToDraft(e.target.value)}
            />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>สถานะ</label>
            <select
              className="input-field"
              value={statusDraft}
              onChange={(e) => setStatusDraft(e.target.value as Status)}
            >
              {TABS.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label} ({counts[tab.key] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <button
            className="button-primary"
            onClick={handleSearch}
            disabled={!canSearch}
            style={{ alignSelf: "flex-end" }}
          >
            ค้นหา
          </button>
          {hasActiveFilters ? (
            <button className="button-ghost" onClick={clearFilters} style={{ alignSelf: "flex-end" }}>
              ล้างตัวกรอง
            </button>
          ) : null}
          {rows.length > 0 ? (
            <button
              className="button-ghost"
              onClick={handleNhsoSync}
              disabled={syncingNhso}
              style={{ alignSelf: "flex-end" }}
            >
              {syncingNhso
                ? "กำลังซิงค์..."
                : selectedIds.size > 0
                ? `ซิงค์สถานะจาก NHSO (${selectedIds.size} รายการ)`
                : "ซิงค์สถานะจาก NHSO (ทั้งหมด)"}
            </button>
          ) : null}
        </div>

        {message ? (
          <div className={`status-message ${isError ? "status-error" : "status-success"}`}>{message}</div>
        ) : null}

        {!hasSearched ? (
          <div className="empty-state">
            <span className="empty-state-icon">📅</span>
            <p style={{ margin: 0, fontWeight: 600 }}>กรุณาเลือกช่วงวันที่ส่งเคลมแล้วกดค้นหา</p>
          </div>
        ) : loading ? (
          <p>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">✅</span>
            <p style={{ margin: 0, fontWeight: 600 }}>ไม่พบข้อมูลในหมวดนี้</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="action-col">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && rows.every((row) => selectedIds.has(row.eclaim_fee_schedule_id))}
                          onChange={toggleSelectAll}
                          title="เลือกทั้งหมด"
                        />
                        จัดการ
                      </div>
                    </th>
                    {COLUMNS.map((col) => (
                      <th key={col.key}>
                        <span
                          onClick={() => handleSort(col.key)}
                          style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          {col.label}
                          <span style={{ opacity: sortKey === col.key ? 1 : 0.3 }}>
                            {sortKey === col.key && sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="action-col">
                      {Object.values(columnFilterDrafts).some((v) => v) ? (
                        <button
                          className="button-ghost"
                          style={{ padding: "6px 10px", fontSize: "0.75rem" }}
                          onClick={clearColumnFilters}
                        >
                          ล้างตัวกรอง
                        </button>
                      ) : null}
                    </th>
                    {COLUMNS.map((col) => (
                      <th key={`filter-${col.key}`} style={{ padding: "6px 8px" }}>
                        <input
                          className="input-field"
                          style={{ padding: "6px 8px", fontSize: "0.8rem", fontWeight: 400 }}
                          value={columnFilterDrafts[col.key] || ""}
                          onChange={(e) => setColumnFilterDrafts({ ...columnFilterDrafts, [col.key]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSearch();
                          }}
                          placeholder="กรอง..."
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.eclaim_fee_schedule_id}>
                      <td className="action-col">
                        <div className="toolbar" style={{ flexWrap: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.eclaim_fee_schedule_id)}
                            onChange={() => toggleSelect(row.eclaim_fee_schedule_id)}
                          />
                          <Link
                            href={`/eclaim-fee-schedule/${row.eclaim_fee_schedule_id}`}
                            className="button-ghost"
                          >
                            แก้ไข
                          </Link>
                          <button
                            className="button-ghost"
                            onClick={() => setPendingDelete(row)}
                            disabled={deletingId === row.eclaim_fee_schedule_id}
                          >
                            {deletingId === row.eclaim_fee_schedule_id ? "กำลังลบ..." : "ลบ"}
                          </button>
                        </div>
                      </td>
                      {COLUMNS.map((col) => {
                        const value = row[col.key];
                        if (col.type === "status") {
                          return <td key={col.key}>{renderStatusPill(value)}</td>;
                        }
                        if (col.type === "date") {
                          return <td key={col.key}>{formatDate(value)}</td>;
                        }
                        if (col.type === "longtext") {
                          return (
                            <td key={col.key} className="wrap">
                              <div
                                style={{
                                  maxWidth: 260,
                                  maxHeight: 90,
                                  overflow: "auto",
                                  whiteSpace: "pre-wrap",
                                  fontFamily: "monospace",
                                  fontSize: "0.8rem",
                                }}
                              >
                                {value || "-"}
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className="wrap">
                            {value ?? "-"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button className="button-ghost" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
                ก่อนหน้า
              </button>
              <span className="card-id">
                หน้า {page} จาก {totalPages} ({total} รายการ)
              </span>
              <button className="button-ghost" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>
                ถัดไป
              </button>
            </div>
          </>
        )}
      </div>

      {pendingDelete ? (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: 0, color: "var(--muted)" }}>ยืนยันการลบข้อมูล VN</p>
            <p className="modal-vn">{pendingDelete.vn}</p>
            <p className="modal-name">{pendingDelete.patient_name || "-"}</p>
            <p style={{ margin: "0 0 24px", color: "var(--muted)" }}>การลบไม่สามารถย้อนกลับได้</p>
            <div className="toolbar" style={{ justifyContent: "center" }}>
              <button className="button-ghost" onClick={() => setPendingDelete(null)}>
                ยกเลิก
              </button>
              <button
                className="button-primary"
                onClick={confirmDelete}
                disabled={deletingId === pendingDelete.eclaim_fee_schedule_id}
              >
                {deletingId === pendingDelete.eclaim_fee_schedule_id ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
