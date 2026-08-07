import { GetServerSideProps } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import { getHospitalName } from "../lib/db";
import { getSession } from "../lib/session";
import { isAdminMode } from "../lib/reports/admin";
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
  // เมนูรายงานเห็นเฉพาะโหมดผู้ดูแล — กันที่หน้าด้วย ไม่ใช่ซ่อนแค่ในแถบเมนู
  // ไม่งั้นพิมพ์ URL ตรงๆ ก็เข้าได้อยู่ดี
  if (!isAdminMode(context.req)) {
    return { redirect: { destination: "/", permanent: false } };
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
/** รายงานที่มากับโปรแกรมแยกได้จาก id ไม่ต้องส่งฟิลด์เพิ่มมาจากเซิร์ฟเวอร์ */
function isBuiltin(report: ReportDefinition): boolean {
  return report.id.startsWith("builtin:");
}

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
  // ชื่อคอลัมน์ภาษาไทยต้องอยู่ใน backtick เสมอ ไม่งั้น MariaDB ฟ้อง syntax error
  sql: `SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS \`วันที่\`,
       COUNT(*) AS \`จำนวนครั้ง\`,
       COUNT(DISTINCT o.hn) AS \`จำนวนคน\`
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
  /** ค่าพารามิเตอร์สำหรับ "ทดลองรัน" ตอนเขียนรายงานเท่านั้น — การรันจริงอยู่หน้า /reports/[id] */
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  /** เครื่องนี้เปิดโหมดผู้ดูแลหรือไม่ — คุมว่าจะมีปุ่มเพิ่ม/แก้/ลบให้เห็นไหม */
  const [admin, setAdmin] = useState(false);
  /** id ของรายงานที่กำลังส่งเข้าส่วนกลาง ใช้ปิดปุ่มระหว่างรอ */
  const [sendingId, setSendingId] = useState("");
  /** หมวดที่ผู้ใช้พับเก็บไว้ — เก็บเป็น "พับ" ไม่ใช่ "เปิด" เพื่อให้หมวดใหม่เปิดมาเห็นเลย */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // กรองด้วยคำค้นก่อนจัดกลุ่ม เพื่อให้หมวดที่ไม่มีผลลัพธ์หายไปทั้งหมวด ไม่เหลือหัวข้อว่างๆ
  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? reports.filter((r) =>
        [r.name, r.description, r.group].some((field) =>
          String(field || "").toLowerCase().includes(keyword)
        )
      )
    : reports;
  const visibleGroups = groupReports(filtered);
  const matchCount = filtered.length;

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setAdmin(!!data.admin);
    } catch {
      setError("โหลดรายการรายงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  /**
   * เปิดรายงานไปรันที่หน้าของตัวเอง
   *
   * แยกหน้าเพราะผลลัพธ์บางรายงานยาวมาก ถ้าต่อท้ายอยู่ในหน้ารวมจะต้องเลื่อนผ่าน
   * รายการรายงานทั้งหมดทุกครั้ง และได้ URL ประจำรายงานไปด้วย ส่งลิงก์ให้กันได้
   */
  function openReport(report: ReportDefinition) {
    void router.push(`/reports/${encodeURIComponent(report.id)}`);
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
    setResult(null);
    setError("");
    const initial: Record<string, string> = {};
    for (const p of report.params || []) initial[p.name] = p.defaultValue || "";
    setValues(initial);
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
      setResult(null);
      await refresh();
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    }
  }

  /**
   * ส่งรายงานใบนี้ไปให้ส่วนกลางพิจารณา
   *
   * ถ้าชื่อซ้ำกับรายงานที่มีอยู่ในระบบแล้ว ฝั่ง API จะตอบ 409 กลับมา
   * ตรงนี้จึงถามผู้ใช้ว่าจะส่งเป็น "คำขอแก้ไข" แทนไหม แทนที่จะปล่อยให้ส่งซ้ำ
   * จนส่วนกลางได้ใบเดียวกันสองใบแล้วต้องมานั่งเดาว่าอันไหนใหม่กว่า
   */
  async function sendToCentral(report: ReportDefinition, kind: "new" | "revision" = "new") {
    setMessage("");
    setError("");
    setSendingId(report.id);
    try {
      const res = await fetch("/api/reports/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, kind }),
      });
      const data = await res.json();

      if (res.status === 409) {
        if (window.confirm(`${data.error}\n\nจะส่งเป็นคำขอแก้ไขรายงานเดิมไหม`)) {
          await sendToCentral(report, "revision");
        }
        return;
      }
      if (!res.ok) {
        setError(data.error || "ส่งคำขอไม่สำเร็จ");
        return;
      }
      setMessage(
        kind === "revision"
          ? `ส่งคำขอแก้ไข "${report.name}" ไปยังส่วนกลางแล้ว`
          : `ส่ง "${report.name}" ไปยังส่วนกลางแล้ว รอผู้ดูแลนำไปสร้างเป็นรายงาน`
      );
    } catch {
      setError("เรียก API ไม่สำเร็จ");
    } finally {
      setSendingId("");
    }
  }

  async function removeReport(report: ReportDefinition) {
    if (!confirm(`ลบรายงาน "${report.name}" ใช่หรือไม่`)) return;
    await fetch(`/api/reports?id=${encodeURIComponent(report.id)}`, { method: "DELETE" });
    if (draft?.id === report.id) setDraft(null);
    await refresh();
  }

  /** ทดลองรันร่างที่ยังไม่ได้บันทึก — ใช้ตอนเขียนเท่านั้น การรันจริงอยู่หน้า /reports/[id] */
  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: draft?.sql, params: draft?.params, values }),
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
    const filename = draft?.name || "รายงาน";
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
      {/* หัวเรื่องซ้าย ปุ่มจัดการขวา — ปุ่มพวกนี้เป็นงานที่ทำนานๆ ครั้ง
          วางไว้มุมขวาบนจึงไม่ไปแย่งที่ของรายการรายงานซึ่งเป็นเนื้อหาหลัก */}
      <div className="reports-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>รายงาน</h1>
          <p className="brand-subtitle" style={{ margin: 0, maxWidth: 820, lineHeight: 1.6 }}>
            {admin
              ? "เครื่องนี้อยู่ในโหมดผู้ดูแล ทดลองเขียนคำสั่ง SELECT ได้ " +
                "เขียนเสร็จแล้วส่งให้ผู้พัฒนาเพิ่มเข้าไปในโปรแกรม เพื่อให้ทุกหน่วยได้ใช้เหมือนกัน"
              : "รายงานที่มากับโปรแกรม กดที่ชื่อรายงานเพื่อดูข้อมูล และส่งออกเป็น Excel ได้ " +
                "ถ้าต้องการรายงานเพิ่มให้แจ้งผู้ดูแล"}
          </p>
        </div>

        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          {/* ปุ่มที่เปลี่ยนแปลงรายงานมีเฉพาะเครื่องผู้ดูแล ฝั่ง API กันไว้อีกชั้นแล้ว */}
          {admin ? (
            <>
              <Link href="/reports/inbox" className="button-ghost">
                คำขอจากผู้ช่วย
              </Link>
              <button className="button-primary" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setResult(null); }}>
                + สร้างรายงานใหม่
              </button>
              <button className="button-ghost" onClick={() => { setDraft({ ...SAMPLE }); setResult(null); }}>
                เริ่มจากตัวอย่าง
              </button>
              <button className="button-ghost" onClick={() => fileInput.current?.click()}>
                นำเข้าไฟล์รายงาน
              </button>
              <button className="button-ghost" onClick={() => exportBundle()} disabled={reports.length === 0}>
                ส่งออกทั้งหมด
              </button>
            </>
          ) : null}
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
      </div>

      {message ? <div className="status-message status-success">{message}</div> : null}
      {error ? <div className="status-message status-error">{error}</div> : null}

      {/* ---- ช่องค้นหา ----
          หน่วยบริการที่ใช้จริงมีรายงานหลักร้อยใบ การไล่หาด้วยตาไม่ไหว
          ค้นจากชื่อ คำอธิบาย และหมวด เพราะคนจำได้ไม่เหมือนกัน บางคนจำชื่อ บางคนจำหมวด */}
      {reports.length > 0 ? (
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <input
            className="input-field"
            style={{ maxWidth: 380 }}
            type="search"
            placeholder="ค้นหาชื่อรายงาน คำอธิบาย หรือหมวด..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="card-id">
            {search.trim()
              ? `พบ ${matchCount.toLocaleString()} จาก ${reports.length.toLocaleString()} รายงาน`
              : `ทั้งหมด ${reports.length.toLocaleString()} รายงาน`}
          </span>
          {search.trim() ? (
            <button className="button-ghost" onClick={() => setSearch("")}>ล้างคำค้น</button>
          ) : null}
        </div>
      ) : null}

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
      ) : matchCount === 0 ? (
        <div className="add-item-card" style={{ padding: "24px 22px", marginBottom: 24 }}>
          <p style={{ margin: 0 }}>ไม่พบรายงานที่ตรงกับ &quot;{search}&quot;</p>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {visibleGroups.map((group) => (
            // พับหมวดเก็บได้ เพราะหน่วยที่มีรายงานเป็นร้อยจะเปิดดูทีละหมวด
            // เปิดค้างไว้ตอนกำลังค้นหา ไม่งั้นผลลัพธ์จะซ่อนอยู่ในหมวดที่พับไว้
            <details key={group.name} open={search.trim() !== "" || !collapsed[group.name]}>
              <summary
                className="report-group-head"
                onClick={(e) => {
                  if (search.trim()) return;
                  e.preventDefault();
                  setCollapsed({ ...collapsed, [group.name]: !collapsed[group.name] });
                }}
              >
                {group.name}
                <span className="card-id" style={{ marginLeft: 8 }}>({group.items.length})</span>
              </summary>

              <div className="report-rows">
                {group.items.map((report, index) => (
                  // ทั้งแถวกดเปิดรายงานได้ ไม่ต้องเล็งปุ่มเล็กๆ
                  // ปุ่มด้านขวาต้อง stopPropagation ไม่งั้นกด "ลบ" แล้วจะเปิดรายงานตามไปด้วย
                  <div
                    className="report-row"
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
                    {/* เลขนับแยกในแต่ละหมวด แบบเดียวกับแท็บในหน้าตรวจก่อนส่งเคลม
                        เพื่อให้อ้างกันได้ว่า "หมวดนั้นข้อ 3" โดยไม่ต้องนับรวมทั้งหน้า */}
                    <span className="report-no">{index + 1}</span>

                    <div className="report-row-text">
                      <span className="report-row-name">{report.name}</span>
                      {isBuiltin(report) ? (
                        <span className="status-pill status-pending">มากับโปรแกรม</span>
                      ) : report.source === "imported" ? (
                        <span className="status-pill status-warn">รับมาจากหน่วยอื่น</span>
                      ) : null}
                      {report.description ? (
                        <span className="report-row-desc">{report.description}</span>
                      ) : null}
                    </div>

                    {/* รายงานที่มากับโปรแกรมแก้/ลบไม่ได้ ต้องแก้ที่โค้ดแล้วปล่อยเวอร์ชันใหม่
                        ไม่งั้นแต่ละหน่วยจะแก้ query กันคนละแบบจนไม่เหลือชุดมาตรฐาน */}
                    <div className="report-row-actions" onClick={(e) => e.stopPropagation()}>
                      {admin && !isBuiltin(report) ? (
                        <button className="button-ghost" onClick={() => editReport(report)}>แก้ไข</button>
                      ) : null}
                      {admin && !isBuiltin(report) ? (
                        <button
                          className="button-ghost"
                          onClick={() => void sendToCentral(report)}
                          disabled={sendingId === report.id}
                        >
                          {sendingId === report.id ? "กำลังส่ง..." : "ส่งเข้าส่วนกลาง"}
                        </button>
                      ) : null}
                      {admin ? (
                        <button className="button-ghost" onClick={() => exportBundle([report.id])}>ส่งออก</button>
                      ) : null}
                      {admin && !isBuiltin(report) ? (
                        <button className="button-ghost" onClick={() => void removeReport(report)}>ลบ</button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

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
              <button className="button-primary" onClick={() => void run()} disabled={running}>
                {running ? "กำลังรัน..." : "ทดลองรัน"}
              </button>
              <button className="button-primary" onClick={() => void saveDraft()}>บันทึกรายงาน</button>
              <button className="button-ghost" onClick={() => { setDraft(null); setResult(null); }}>ยกเลิก</button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- ผลลัพธ์ของการทดลองรันตอนเขียน ---- */}
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
