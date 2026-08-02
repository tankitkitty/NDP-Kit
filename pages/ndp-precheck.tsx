import { useEffect, useMemo, useState } from "react";
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

// ---------- โครงข้อมูลที่ API ส่งกลับ (ตรงกับ lib/precheck/types.ts) ----------
type CheckColumn = { key: string; label: string };
type CheckSection = { title?: string; columns: CheckColumn[]; rows: Record<string, unknown>[]; note?: string };
type CheckOutcome = {
  id: string;
  status: "pass" | "issues" | "info" | "unavailable";
  problemCount: number;
  summary: string;
  sections: CheckSection[];
  advice: string;
  fixSql?: string;
  canExecuteFix?: boolean;
  error?: string;
};

// ---------- ทะเบียนการ์ด (ลำดับ/คำอธิบายตรงกับ lib/precheck/index.ts) ----------
type CardMeta = { id: string; no: number; title: string; description: string; needsRange?: boolean };

const QUERY_CARDS: CardMeta[] = [
  { id: "deformed-no", no: 1, title: "เลขบัตรผู้พิการตรงกับเลขบัตรประชาชน", description: "person_deformed.deformed_no ต้องเท่ากับ person.cid (ตัดขีดออก)" },
  { id: "po-code", no: 2, title: "รหัสไปรษณีย์ผู้ป่วยครบ 5 หลัก", description: "patient.po_code ที่ไม่ว่างต้องเป็นตัวเลข 5 หลักพอดี" },
  { id: "provider", no: 3, title: "ข้อมูลบุคลากรทางการแพทย์ (PROVIDER)", description: "เลขใบประกอบวิชาชีพ / เลขบัตร ปชช. / provider_type / รหัสสภาวิชาชีพ (01-07) ต้องครบ" },
  { id: "pttype-config", no: 4, title: "การตั้งค่าสิทธิการรักษา (pttype)", description: "noexpire / export_eclaim / is_pttype_plan / default_request_funds / paidst='02' / price group (1=OFC/LGO, 2=UC/WEL)" },
  { id: "token", no: 5, title: "Token สำหรับส่งแฟ้ม 13 แฟ้ม", description: "sys_var (%token%) ต้องมีค่า และ NHSO token ต้องยังไม่หมดอายุ" },
  { id: "drug-catalog", no: 6, title: "รหัสยาเทียบ Drug Catalog / TMT", description: "sks_drug_code, ราคา และหมวด income ต้องตรงกับ Drug Catalog รายการล่าสุด" },
  { id: "service-price", no: 7, title: "ราคาที่คีย์จริงเทียบราคาตั้งต้น", description: "opitemrece.unitprice เทียบ drugitems.unitprice ในช่วงวันที่ที่เลือก", needsRange: true },
  { id: "auth-code", no: 9, title: "เคสที่ยังไม่มีเลขปิดสิทธิ (Authorization)", description: "visit ในช่วงวันที่ที่เลือกที่ยังไม่มี auth_code — ต้องปิดสิทธิ/ออกใบแจ้งหนี้ก่อนส่งเคลม", needsRange: true },
  { id: "claim-log", no: 10, title: "ประวัติการส่งเคลมล่าสุด", description: "ค้นหาตาราง log การส่ง NDP/eClaim ในฐานอัตโนมัติ แล้วแสดงรายการส่งล่าสุดพร้อม error (ถ้ามี)" },
];

// ---------- การ์ดที่ 8: checklist รหัสบริการคัดกรอง NDP (อ้างอิง ไม่ query เพราะรหัสแต่ละหน่วยต่างกัน) ----------
const NDP_SERVICE_ITEMS: { key: string; label: string; hint: string }[] = [
  { key: "hpv", label: "คัดกรองมะเร็งปากมดลูก (HPV)", hint: "ตั้งรหัสค่าบริการเก็บสิ่งส่งตรวจ/ค่าตรวจ HPV ให้ตรง Fee Schedule" },
  { key: "dm", label: "คัดกรองเบาหวาน (FBS/DTX)", hint: "รหัสค่าตรวจน้ำตาลสำหรับกลุ่มเป้าหมายคัดกรอง" },
  { key: "chol", label: "Cholesterol + HDL", hint: "รหัสค่าตรวจไขมันตามชุดสิทธิประโยชน์" },
  { key: "cbc", label: "คัดกรองภาวะโลหิตจาง CBC (13-24 ปี)", hint: "รหัสค่าตรวจ CBC สำหรับช่วงอายุ 13-24 ปี" },
  { key: "fluoride", label: "เคลือบฟลูออไรด์กลุ่มเสี่ยง", hint: "รหัสหัตถการทันตกรรมเคลือบฟลูออไรด์" },
  { key: "fit", label: "คัดกรองมะเร็งลำไส้ใหญ่ (Fit Test)", hint: "รหัสค่าตรวจ Fit Test" },
  { key: "hep", label: "คัดกรองไวรัสตับอักเสบ (HBsAg/Anti-HCV)", hint: "รหัสค่าตรวจไวรัสตับอักเสบ บี/ซี" },
  { key: "flu", label: "วัคซีนไข้หวัดใหญ่ (ICD10 Z251) และวัคซีนอื่นๆ", hint: "ลงรหัสวัคซีน + ICD10 Z251 สำหรับไข้หวัดใหญ่ให้ครบ" },
  { key: "contraceptive", label: "ยาคุมกำเนิด (ชนิดเม็ด/ฉีด)", hint: "ตั้งรหัสยา/ค่าบริการวางแผนครอบครัวให้เบิกได้" },
  { key: "condom", label: "ถุงยางอนามัย", hint: "รหัสเวชภัณฑ์ถุงยางอนามัยตามสิทธิประโยชน์" },
];
const NDP_SERVICE_STORE_KEY = "ndp-service-checklist-v1";

const DEFAULT_RANGE = getCurrentMonthRange();

// สถานะการ์ดฝั่ง client
type CardState = {
  loading: boolean;
  outcome: CheckOutcome | null;
  expanded: boolean;
  fetchError: string | null;
};

function statusPill(outcome: CheckOutcome | null, loading: boolean) {
  if (loading) return <span className="status-pill status-pending">กำลังตรวจ...</span>;
  if (!outcome) return <span className="status-pill status-pending">ยังไม่ได้ตรวจ</span>;
  if (outcome.status === "pass") return <span className="status-pill status-y">✅ ผ่าน</span>;
  if (outcome.status === "issues")
    return <span className="status-pill status-n">⚠️ พบปัญหา {outcome.problemCount.toLocaleString()} รายการ</span>;
  if (outcome.status === "info") return <span className="status-pill status-pending">ℹ️ ข้อมูลประกอบ</span>;
  return <span className="status-pill status-n">ตรวจไม่ได้</span>;
}

export default function NdpPrecheck({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [from, setFrom] = useState(DEFAULT_RANGE.start);
  const [to, setTo] = useState(DEFAULT_RANGE.end);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // การ์ด 8: checklist อ้างอิง เก็บสถานะใน localStorage
  const [serviceChecked, setServiceChecked] = useState<Record<string, boolean>>({});
  const [serviceExpanded, setServiceExpanded] = useState(false);

  // modal ยืนยันก่อนรัน UPDATE (แยกจากปุ่ม copy เสมอ)
  const [fixTarget, setFixTarget] = useState<CardMeta | null>(null);
  const [fixBackupAck, setFixBackupAck] = useState(false);
  const [fixRunning, setFixRunning] = useState(false);
  const [fixMessage, setFixMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NDP_SERVICE_STORE_KEY);
      if (raw) setServiceChecked(JSON.parse(raw));
    } catch {
      /* ค่าเสีย ใช้ค่าว่างแทน */
    }
  }, []);

  function toggleService(key: string) {
    setServiceChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(NDP_SERVICE_STORE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const serviceDone = useMemo(
    () => NDP_SERVICE_ITEMS.filter((i) => serviceChecked[i.key]).length,
    [serviceChecked]
  );

  function getState(id: string): CardState {
    return cards[id] || { loading: false, outcome: null, expanded: false, fetchError: null };
  }

  function patchState(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...getStateFrom(prev, id), ...patch } }));
  }

  function getStateFrom(map: Record<string, CardState>, id: string): CardState {
    return map[id] || { loading: false, outcome: null, expanded: false, fetchError: null };
  }

  async function runCheck(meta: CardMeta) {
    patchState(meta.id, { loading: true, fetchError: null });
    try {
      const params = new URLSearchParams({ check: meta.id });
      if (meta.needsRange) {
        params.set("from", from);
        params.set("to", to);
      }
      const res = await fetch(`/api/precheck/run?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        patchState(meta.id, { loading: false, outcome: data as CheckOutcome });
      } else {
        patchState(meta.id, { loading: false, fetchError: data.error || "ตรวจสอบไม่สำเร็จ" });
      }
    } catch {
      patchState(meta.id, { loading: false, fetchError: "เรียก API ไม่สำเร็จ" });
    }
  }

  async function runAll() {
    setRunningAll(true);
    // รันทีละใบ เพื่อไม่ยิงฐาน HOSxP พร้อมกันหลาย query หนักๆ
    for (const meta of QUERY_CARDS) {
      await runCheck(meta);
    }
    setRunningAll(false);
  }

  async function copySql(id: string, sql: string) {
    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      // เบราว์เซอร์เก่า/ไม่ใช่ https: เลือกข้อความให้ผู้ใช้กด Ctrl+C เอง
      const ta = document.createElement("textarea");
      ta.value = sql;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  }

  async function executeFix() {
    if (!fixTarget) return;
    setFixRunning(true);
    setFixMessage(null);
    try {
      const res = await fetch("/api/precheck/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId: fixTarget.id, confirm: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setFixMessage({ text: data.message || "แก้ไขสำเร็จ", error: false });
        // ตรวจซ้ำอัตโนมัติเพื่ออัปเดตสถานะการ์ด
        await runCheck(fixTarget);
      } else {
        setFixMessage({ text: data.error || "รันคำสั่งแก้ไขไม่สำเร็จ", error: true });
      }
    } catch {
      setFixMessage({ text: "เรียก API ไม่สำเร็จ", error: true });
    } finally {
      setFixRunning(false);
    }
  }

  function renderSection(section: CheckSection, idx: number) {
    return (
      <div key={idx} style={{ marginTop: idx === 0 ? 0 : 16 }}>
        {section.title ? <div className="precheck-section-title">{section.title}</div> : null}
        {section.rows.length > 0 ? (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  {section.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr key={i}>
                    {section.columns.map((c) => (
                      <td key={c.key} className="wrap">
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
        ) : null}
        {section.note ? <div className="precheck-note">{section.note}</div> : null}
      </div>
    );
  }

  function renderCard(meta: CardMeta) {
    const state = getState(meta.id);
    const outcome = state.outcome;
    return (
      <div key={meta.id} className="precheck-card">
        <div className="precheck-card-head">
          <div style={{ minWidth: 0 }}>
            <div className="precheck-card-title">
              {meta.no}. {meta.title}
              {meta.needsRange ? <span className="precheck-range-tag">ใช้ช่วงวันที่</span> : null}
            </div>
            <div className="precheck-card-desc">{meta.description}</div>
            {outcome ? <div className="precheck-card-summary">{outcome.summary}</div> : null}
            {state.fetchError ? (
              <div className="precheck-card-summary" style={{ color: "#b91c1c" }}>{state.fetchError}</div>
            ) : null}
          </div>
          <div className="precheck-card-actions">
            {statusPill(outcome, state.loading)}
            <button className="button-ghost precheck-small-btn" onClick={() => runCheck(meta)} disabled={state.loading || runningAll}>
              {outcome ? "ตรวจซ้ำ" : "ตรวจ"}
            </button>
            {outcome && (outcome.sections.length > 0 || outcome.advice || outcome.error) ? (
              <button className="button-ghost precheck-small-btn" onClick={() => patchState(meta.id, { expanded: !state.expanded })}>
                {state.expanded ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
              </button>
            ) : null}
          </div>
        </div>

        {outcome && state.expanded ? (
          <div className="precheck-card-body">
            {outcome.error ? (
              <div className="status-message status-error" style={{ marginBottom: 12 }}>
                {outcome.error}
              </div>
            ) : null}
            {outcome.sections.map((s, i) => renderSection(s, i))}
            {outcome.advice ? (
              <div className="precheck-advice">
                <div className="precheck-section-title">คำแนะนำการแก้ไข</div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{outcome.advice}</p>
              </div>
            ) : null}
            {outcome.fixSql ? (
              <div style={{ marginTop: 12 }}>
                <div className="precheck-section-title">SQL แก้ไข (copy ไปรันใน SQL Query ของ HOSxP — ระบบไม่รันให้อัตโนมัติ)</div>
                <pre className="sql-block">{outcome.fixSql}</pre>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <button className="button-ghost precheck-small-btn" onClick={() => copySql(meta.id, outcome.fixSql!)}>
                    {copiedId === meta.id ? "คัดลอกแล้ว ✓" : "คัดลอก SQL"}
                  </button>
                  {outcome.canExecuteFix ? (
                    <button
                      className="button-primary precheck-small-btn"
                      onClick={() => {
                        setFixTarget(meta);
                        setFixBackupAck(false);
                        setFixMessage(null);
                      }}
                    >
                      รันคำสั่งแก้ไขจากระบบ...
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Layout title="ตรวจก่อนส่งเคลม NDP" loginname={loginname} hospitalName={hospitalName} fullWidth>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>ตรวจความพร้อมก่อนส่งเคลม 13 แฟ้ม (NDP)</h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 20 }}>
          ตรวจข้อมูลในฐาน HOSxP ตามเงื่อนไขของ NHSO Digital Platform ก่อนส่งเคลม เพื่อลดเคลมตีกลับ — ทุกการตรวจเป็นการอ่านข้อมูลอย่างเดียว (SELECT) ส่วนคำสั่งแก้ไขต้อง copy ไปรันเองหรือกดยืนยันแยกต่างหาก
        </p>

        <div className="toolbar" style={{ marginBottom: 20 }}>
          <div className="label-group" style={{ gap: 4 }}>
            <label>ช่วงวันที่ (ใช้กับข้อ 7 และ 9) ตั้งแต่</label>
            <DateField value={from} max={to || undefined} onChange={setFrom} />
          </div>
          <div className="label-group" style={{ gap: 4 }}>
            <label>ถึงวันที่</label>
            <DateField value={to} min={from || undefined} onChange={setTo} />
          </div>
          <button className="button-primary" onClick={runAll} disabled={runningAll} style={{ alignSelf: "flex-end" }}>
            {runningAll ? "กำลังตรวจทั้งหมด..." : "ตรวจทั้งหมด"}
          </button>
        </div>

        <div className="precheck-list">
          {QUERY_CARDS.slice(0, 7).map((meta) => renderCard(meta))}

          {/* การ์ด 8: checklist อ้างอิง (ไม่ query — รหัสของแต่ละหน่วยบริการต่างกัน) */}
          <div className="precheck-card">
            <div className="precheck-card-head">
              <div style={{ minWidth: 0 }}>
                <div className="precheck-card-title">8. รหัสบริการคัดกรองตามที่ NDP กำหนด (checklist อ้างอิง)</div>
                <div className="precheck-card-desc">
                  รหัสค่าบริการ/หัตถการของแต่ละหน่วยบริการไม่เหมือนกัน จึงให้ติ๊กยืนยันเองว่าตั้งรหัสครบแล้ว (สถานะเก็บในเครื่องนี้)
                </div>
              </div>
              <div className="precheck-card-actions">
                {serviceDone === NDP_SERVICE_ITEMS.length ? (
                  <span className="status-pill status-y">✅ ครบ {serviceDone}/{NDP_SERVICE_ITEMS.length}</span>
                ) : (
                  <span className="status-pill status-pending">ทำแล้ว {serviceDone}/{NDP_SERVICE_ITEMS.length}</span>
                )}
                <button className="button-ghost precheck-small-btn" onClick={() => setServiceExpanded(!serviceExpanded)}>
                  {serviceExpanded ? "ซ่อนรายการ" : "ดูรายการ"}
                </button>
              </div>
            </div>
            {serviceExpanded ? (
              <div className="precheck-card-body">
                {NDP_SERVICE_ITEMS.map((item) => (
                  <label key={item.key} className="precheck-check-item">
                    <input type="checkbox" checked={Boolean(serviceChecked[item.key])} onChange={() => toggleService(item.key)} />
                    <span>
                      <span style={{ fontWeight: 600 }}>{item.label}</span>
                      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem" }}>{item.hint}</span>
                    </span>
                  </label>
                ))}
                <div className="precheck-note">
                  ตรวจรหัสได้จากหน้าจอค่ารักษาพยาบาล/หัตถการใน HOSxP เทียบกับประกาศ Fee Schedule ของ สปสช. ฉบับล่าสุด
                </div>
              </div>
            ) : null}
          </div>

          {QUERY_CARDS.slice(7).map((meta) => renderCard(meta))}
        </div>
      </div>

      {fixTarget ? (
        <div className="modal-backdrop" onClick={() => !fixRunning && setFixTarget(null)}>
          <div className="modal-card" style={{ maxWidth: 560, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title" style={{ marginTop: 0 }}>ยืนยันรันคำสั่งแก้ไข (UPDATE)</h2>
            <p style={{ margin: "0 0 8px" }}>
              หัวข้อ: <strong>{fixTarget.no}. {fixTarget.title}</strong>
            </p>
            <div className="status-message status-error" style={{ marginBottom: 12 }}>
              ⚠ ตาราง HOSxP เป็น MyISAM ไม่มี transaction — รันแล้ว<strong>ย้อนกลับไม่ได้</strong> ควรสำรองตารางก่อน เช่น<br />
              <code style={{ fontSize: "0.85rem" }}>CREATE TABLE person_deformed_bak AS SELECT * FROM person_deformed;</code>
            </div>
            <pre className="sql-block">{getState(fixTarget.id).outcome?.fixSql}</pre>
            <label className="precheck-check-item" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={fixBackupAck} onChange={(e) => setFixBackupAck(e.target.checked)} />
              <span>ฉันได้สำรองข้อมูลตารางที่เกี่ยวข้องแล้ว และเข้าใจว่าการแก้ไขนี้ย้อนกลับไม่ได้</span>
            </label>
            {fixMessage ? (
              <div className={`status-message ${fixMessage.error ? "status-error" : "status-success"}`} style={{ marginTop: 12 }}>
                {fixMessage.text}
              </div>
            ) : null}
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="button-ghost" onClick={() => setFixTarget(null)} disabled={fixRunning}>
                ปิด
              </button>
              <button className="button-primary" onClick={executeFix} disabled={!fixBackupAck || fixRunning}>
                {fixRunning ? "กำลังรัน..." : "ยืนยันรันคำสั่งแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
