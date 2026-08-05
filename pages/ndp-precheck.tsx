import { useEffect, useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
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
  status: "pass" | "issues" | "empty" | "info" | "unavailable";
  problemCount: number;
  summary: string;
  sections: CheckSection[];
  advice: string;
  fixSql?: string;
  canExecuteFix?: boolean;
  error?: string;
};

// ---------- ทะเบียนการ์ด (คำอธิบายตรงกับ lib/precheck/index.ts) ----------
// ไม่เก็บเลขข้อไว้ตรงนี้ เพราะเลขที่แสดงคือลำดับ "ภายในแท็บ" ซึ่งคำนวณจาก TABS ด้านล่าง
// (ดู CARD_NO) ถ้าเก็บไว้สองที่จะหลุดไม่ตรงกันทันทีที่ย้ายการ์ดข้ามแท็บ
type CardMeta = { id: string; title: string; description: string; needsRange?: boolean };

const QUERY_CARDS: CardMeta[] = [
  { id: "deformed-no", title: "เลขบัตรผู้พิการตรงกับเลขบัตรประชาชน", description: "person_deformed.deformed_no ต้องเท่ากับ person.cid (ตัดขีดออก)" },
  { id: "po-code", title: "รหัสไปรษณีย์ผู้ป่วยครบ 5 หลัก", description: "patient.po_code ที่ไม่ว่างต้องเป็นตัวเลข 5 หลักพอดี" },
  { id: "provider", title: "ข้อมูลบุคลากรทางการแพทย์ (PROVIDER)", description: "เลขใบประกอบวิชาชีพ / เลขบัตร ปชช. / provider_type ต้องครบ และกลุ่มวิชาชีพ (แพทย์ ทันตแพทย์ พยาบาล เภสัชกร ฯลฯ) ต้องมีรหัสสภาวิชาชีพ 01-08" },
  { id: "pttype-config", title: "การตั้งค่าสิทธิการรักษา (pttype)", description: "noexpire / export_eclaim / is_pttype_plan / default_request_funds / paidst='02' / price group (1=OFC/LGO, 2=UC/WEL)" },
  { id: "token", title: "Token สำหรับส่งแฟ้ม 13 แฟ้ม", description: "sys_var (%token%) ต้องมีค่า และ NHSO token ต้องยังไม่หมดอายุ" },
  { id: "drug-catalog", title: "รหัสยาเทียบ Drug Catalog / TMT", description: "drugitems.sks_drug_code และราคา ต้องตรงกับ TMT/ราคาใน Drug Catalog รายการล่าสุด" },
  { id: "service-price", title: "ราคาที่คีย์จริงเทียบราคาตั้งต้น", description: "opitemrece.unitprice เทียบ drugitems.unitprice ในช่วงวันที่ที่เลือก", needsRange: true },
  { id: "auth-code", title: "เคสที่ยังไม่มีเลขปิดสิทธิ (Authorization)", description: "visit ในช่วงวันที่ที่เลือกที่ยังไม่มี auth_code — ต้องปิดสิทธิ/ออกใบแจ้งหนี้ก่อนส่งเคลม", needsRange: true },
  { id: "claim-log", title: "ประวัติการส่งเคลมล่าสุด", description: "ค้นหาตาราง log การส่ง NDP/eClaim ในฐานอัตโนมัติ แล้วแสดงรายการส่งล่าสุดพร้อม error (ถ้ามี)" },
  { id: "spclty-nhso-code", title: "รหัสแผนกของ สปสช. (spclty.nhso_code)", description: "แสดงการ map แผนกทั้งหมดกับรหัส สปสช. เน้นสีแดงแถวที่รหัสไม่ใช่ 01-12 และสีเหลืองแถวที่ชื่อแผนกดูไม่ตรงกับรหัส" },
  { id: "postnatal-care", title: "บริการตรวจหลังคลอด (ICD-10 Z39 + ADP 30015)", description: "เคสตรวจหลังคลอดต้องมีทั้ง ICD-10 Z390/Z391/Z392 และรายการค่าบริการรหัส ADP 30015 — ขาดอย่างใดอย่างหนึ่งเบิกไม่ได้", needsRange: true },
  { id: "triferdine", title: "บริการจ่ายยา Triferdine (ICD-10 Z392 + ADP 30016)", description: "เคสจ่ายยา Triferdine ต้องมีครบทั้ง ICD-10 Z392, ค่าบริการรหัส ADP 30016 และรายการยารหัส 737390 หรือ 689609", needsRange: true },
  { id: "pregnancy-test", title: "บริการชุดทดสอบการตั้งครรภ์ (ICD-10 Z32 + ADP 30014/30017/31101)", description: "เคสชุดทดสอบการตั้งครรภ์ต้องมีทั้ง ICD-10 Z320 หรือ Z321 และค่าบริการรหัส ADP 30014 / 30017 หรือ CSMBS 31101", needsRange: true },
  { id: "contraceptive", title: "บริการยาเม็ดและยาฉีดคุมกำเนิด (ICD-10 Z304 + รหัส TMT)", description: "เคสคุมกำเนิดต้องมีทั้ง ICD-10 Z304 และรายการยาที่ตั้งรหัส TMT ตรงตามที่ สปสช. กำหนด (23 รหัส)", needsRange: true },
  { id: "condom", title: "บริการถุงยางพร้อมให้คำปรึกษา (ICD-10 Z30 + bill code)", description: "เคสถุงยางพร้อมให้คำปรึกษาต้องมีทั้ง ICD-10 Z30/Z300/Z304/Z309 และรายการค่าบริการ bill code 6201001/6201005/6201006/6201007", needsRange: true },
];

/**
 * แบ่งการ์ดเป็นแท็บตามลักษณะงานของคนที่ต้องแก้
 *
 * เรียงแท็บตรวจข้อมูลการบริการไว้เป็นอันแรกและเป็นแท็บที่เปิดมาเจอ เพราะเป็นงานที่
 * ต้องทำซ้ำทุกรอบส่งเคลม ส่วนอีกสองแท็บเป็นการตั้งค่าที่ทำครั้งเดียวก็จบ
 *
 * ลำดับใน ids คือลำดับที่แสดงและเป็นที่มาของเลขข้อบนการ์ด (ดู CARD_NO)
 */
const TABS: { key: string; label: string; hint: string; ids: string[] }[] = [
  {
    key: "service",
    label: "ตรวจข้อมูลการบริการ",
    hint: "ตรวจข้อมูลที่คีย์จริงในช่วงวันที่ที่เลือก ก่อนส่งเคลมแต่ละรอบ",
    ids: ["auth-code", "postnatal-care", "triferdine", "pregnancy-test", "contraceptive", "condom", "claim-log"],
  },
  {
    key: "master",
    label: "ข้อมูลตั้งต้นและการตั้งค่า",
    hint: "ตั้งครั้งเดียวแล้วใช้ได้ตลอด — ทะเบียนผู้ป่วย บุคลากร สิทธิ token และรหัสแผนก",
    ids: ["deformed-no", "po-code", "provider", "pttype-config", "token", "spclty-nhso-code"],
  },
  {
    key: "codes",
    label: "รหัสบริการและราคา",
    hint: "รหัสยา/ค่าบริการและราคาที่ใช้อ้างอิงตอนส่งเคลม",
    ids: ["drug-catalog", "service-price"],
  },
];

/**
 * เลขข้อที่แสดงบนการ์ด = ลำดับภายในแท็บของตัวเอง (แต่ละแท็บเริ่มนับ 1 ใหม่)
 *
 * เลขชุดเดียวยาว 1-14 ทั้งหน้าใช้ไม่ได้แล้วเมื่อแยกแท็บ เพราะผู้ใช้เห็นทีละแท็บ
 * แล้วเลขจะกระโดด (เช่นแท็บแรกขึ้นต้นด้วยข้อ 9) — คำนวณจาก TABS ที่เดียว
 * เพื่อให้ย้ายการ์ดข้ามแท็บแล้วเลขขยับตามเองโดยไม่ต้องไล่แก้
 */
const CARD_NO: Record<string, number> = {};
for (const tab of TABS) {
  tab.ids.forEach((id, i) => {
    CARD_NO[id] = i + 1;
  });
}

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
  // ไม่มีข้อมูลให้ตรวจ = ยังตัดสินไม่ได้ ใช้ป้ายกลางๆ ไม่ใช่สีแดงหรือเขียว
  if (outcome.status === "empty") return <span className="status-pill status-pending">ไม่พบข้อมูลให้ตรวจ</span>;
  if (outcome.status === "info") return <span className="status-pill status-pending">ℹ️ ข้อมูลประกอบ</span>;
  return <span className="status-pill status-n">ตรวจไม่ได้</span>;
}

export default function NdpPrecheck({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [from, setFrom] = useState(DEFAULT_RANGE.start);
  const [to, setTo] = useState(DEFAULT_RANGE.end);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  // แท็บย่อยของตารางผลตรวจในแต่ละการ์ด เก็บแยกกันด้วยคีย์ "<id การ์ด>#<ลำดับตาราง>"
  const [sectionTab, setSectionTab] = useState<Record<string, string>>({});
  // ตารางที่กำลังสร้างไฟล์ Excel อยู่ (คีย์เดียวกับ sectionTab) เพื่อกันกดซ้ำ
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  // เปิดแท็บตามที่ลิงก์ระบุมา เช่น /ndp-precheck?tab=master จากหน้า setup-checklist
  // ต้องทำใน effect ไม่ใช่ค่าเริ่มต้นของ useState เพราะ router.query ยังว่างตอน render แรก
  const router = useRouter();
  useEffect(() => {
    const wanted = router.query.tab;
    if (typeof wanted === "string" && TABS.some((t) => t.key === wanted)) setActiveTab(wanted);
  }, [router.query.tab]);

  // modal ยืนยันก่อนรัน UPDATE (แยกจากปุ่มอื่นเสมอ เพราะรันแล้วย้อนกลับไม่ได้)
  const [fixTarget, setFixTarget] = useState<CardMeta | null>(null);
  const [fixBackupAck, setFixBackupAck] = useState(false);
  const [fixRunning, setFixRunning] = useState(false);
  const [fixMessage, setFixMessage] = useState<{ text: string; error: boolean } | null>(null);

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

  /**
   * ตรวจทุกใบ "ในแท็บที่เปิดอยู่" เท่านั้น ไม่ลามไปแท็บอื่น
   *
   * เดิมปุ่มเดียวยิงครบทุกใบทั้งหน้า ซึ่งกินเวลาและไปรันหัวข้อตั้งค่าที่ไม่เกี่ยวกับ
   * รอบส่งเคลมด้วย ทั้งที่คนกดอยู่แท็บงานบริการและตั้งใจตรวจแค่ข้อมูลบริการของช่วง
   * วันที่ที่เลือก
   */
  async function runTab(ids: string[]) {
    setRunningAll(true);
    // รันทีละใบ เพื่อไม่ยิงฐาน HOSxP พร้อมกันหลาย query หนักๆ
    for (const id of ids) {
      const meta = QUERY_CARDS.find((c) => c.id === id);
      if (meta) await runCheck(meta);
    }
    setRunningAll(false);
  }

  /**
   * ส่งออกตารางที่กำลังแสดงอยู่เป็นไฟล์ Excel
   *
   * ส่งเฉพาะแถวที่เห็นอยู่จริง (ผ่านการกรองด้วยแท็บย่อยแล้ว) ไม่ใช่ทั้งชุด
   * เพราะที่ผู้ใช้กดคือ "เอารายการที่เห็นตรงหน้านี้ออกไป"
   */
  async function exportRows(
    key: string,
    filename: string,
    columns: CheckColumn[],
    rows: Record<string, unknown>[]
  ) {
    setExportingKey(key);
    try {
      const res = await fetch("/api/precheck/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, columns, rows }),
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

  function renderSection(cardId: string, section: CheckSection, idx: number) {
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
    const tabKey = `${cardId}#${idx}`;
    const activeSub = sectionTab[tabKey] || (failRows.length > 0 ? "fail" : warnRows.length > 0 ? "warn" : "all");
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
    const cardTitle = QUERY_CARDS.find((c) => c.id === cardId)?.title || cardId;
    const exportName = `${cardTitle}${section.title ? ` - ${section.title}` : ""}`;
    const exportKey = `${cardId}#${idx}`;

    return (
      <div key={idx} style={{ marginTop: idx === 0 ? 0 : 16 }}>
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
              {warnRows.length > 0 ? <span className="tally-warn">ควรตรวจทาน {warnRows.length} ราย</span> : null}
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
                  onClick={() => setSectionTab((prev) => ({ ...prev, [tabKey]: t.key }))}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {shown.length > 0 ? (
          // สูง 480px ไม่ใช่ 360px แบบเดิม เพราะแถวที่มีข้อความยาวสูงกว่าหนึ่งบรรทัด
          // ของเดิมจึงเห็นได้แค่สามสี่แถวแล้วต้องเลื่อนตลอด
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  {section.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* ตารางที่บอกผลถูก/ผิดต้องติดสีพื้นทุกแถวตามกติกาของโปรเจ็ค แถวที่ถูกต้อง
                    เป็นเขียวอ่อน ส่วนตารางอ้างอิงที่ไม่มีผลถูก/ผิด (graded = false) ปล่อยขาว */}
                {shown.map((row, i) => (
                  <tr
                    key={i}
                    className={
                      row._alert ? "row-alert" : row._warn ? "row-warn" : graded ? "row-ok" : undefined
                    }
                  >
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
        {section.note ? <div className="precheck-note">{section.note}</div> : null}
      </div>
    );
  }

  function renderCard(meta: CardMeta) {
    const state = getState(meta.id);
    const outcome = state.outcome;
    // ติดสีการ์ดตามผลตรวจตามกติกาสีของโปรเจ็ค (ดู styles/globals.css)
    // ใบที่ยังไม่ได้ตรวจไม่ติดสี เพราะยังไม่รู้ผล
    const cardState = !outcome
      ? ""
      : outcome.status === "pass"
        ? "state-ok"
        : outcome.status === "issues" || outcome.status === "unavailable"
          ? "state-alert"
          : "";

    return (
      <div key={meta.id} className={`precheck-card ${cardState}`}>
        <div className="precheck-card-head">
          <div style={{ minWidth: 0 }}>
            <div className="precheck-card-title">
              {CARD_NO[meta.id]}. {meta.title}
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
            {outcome.sections.map((s, i) => renderSection(meta.id, s, i))}
            {outcome.advice ? (
              <div className="precheck-advice">
                <div className="precheck-section-title">คำแนะนำการแก้ไข</div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{outcome.advice}</p>
              </div>
            ) : null}
            {/* ไม่แสดงบล็อก SQL แก้ไขบนหน้าแล้ว — ผู้ใช้งานจริงเป็นเจ้าหน้าที่เวชระเบียน
                ไม่ได้รันคำสั่งเอง มีแต่ทำให้การ์ดยาวจนคำแนะนำที่ต้องอ่านจริงถูกดันตกไป
                ส่วนหัวข้อที่ระบบรันแก้ให้ได้ ยังเหลือปุ่มยืนยัน ซึ่งจะโชว์คำสั่งใน
                หน้าต่างยืนยันก่อนรันอยู่แล้ว */}
            {outcome.canExecuteFix ? (
              <div className="toolbar" style={{ marginTop: 12 }}>
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
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  /**
   * ป้ายบนหัวแท็บ: บอกว่าแท็บนั้นมีการ์ดที่ยังมีปัญหากี่ใบ
   * จำเป็นเพราะพอแยกแท็บแล้ว การ์ดที่มีปัญหาในแท็บอื่นจะมองไม่เห็น
   */
  function tabBadge(ids: string[]) {
    const metas = ids
      .map((id) => QUERY_CARDS.find((c) => c.id === id))
      .filter((m): m is CardMeta => Boolean(m));
    const done = metas.filter((m) => getState(m.id).outcome);
    if (done.length === 0) return null;
    const issues = done.filter((m) => {
      const s = getState(m.id).outcome!.status;
      return s === "issues" || s === "unavailable";
    });
    if (issues.length > 0) return <span className="tab-badge tab-badge-alert">{issues.length}</span>;
    if (done.length === metas.length) return <span className="tab-badge tab-badge-ok">✓</span>;
    return null;
  }

  const currentTab = TABS.find((t) => t.key === activeTab) || TABS[0];
  // แสดงช่องช่วงวันที่เฉพาะแท็บที่มีหัวข้อซึ่งใช้ช่วงวันที่จริง (ดูจาก needsRange ของการ์ด)
  // ไม่ผูกกับชื่อแท็บ เพราะถ้าย้ายการ์ดข้ามแท็บทีหลังจะได้ไม่ต้องกลับมาแก้ตรงนี้
  const tabUsesRange = currentTab.ids.some((id) => QUERY_CARDS.find((c) => c.id === id)?.needsRange);

  return (
    <Layout title="ตรวจก่อนส่งเคลม NDP" loginname={loginname} hospitalName={hospitalName} fullWidth>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>ตรวจความพร้อมก่อนส่งเคลม 13 แฟ้ม (NDP)</h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 20 }}>
          ตรวจข้อมูลในฐาน HOSxP ตามเงื่อนไขของ NHSO Digital Platform ก่อนส่งเคลม เพื่อลดเคลมตีกลับ — ทุกการตรวจเป็นการอ่านข้อมูลอย่างเดียว (SELECT) ส่วนคำสั่งแก้ไขต้อง copy ไปรันเองหรือกดยืนยันแยกต่างหาก
        </p>

        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tab ${tab.key === activeTab ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {tabBadge(tab.ids)}
            </button>
          ))}
        </div>
        <p className="precheck-note" style={{ marginTop: -16, marginBottom: 12 }}>{currentTab.hint}</p>

        {/* แถบเครื่องมือของแท็บ ไม่ใช่ของทั้งหน้า — ช่วงวันที่โผล่เฉพาะแท็บที่มีหัวข้อ
            ซึ่งใช้ช่วงวันที่จริงๆ และปุ่มตรวจทั้งหมดตรวจเฉพาะหัวข้อในแท็บนี้เท่านั้น
            เพราะคนที่อยู่แท็บงานบริการตั้งใจตรวจข้อมูลของรอบส่งเคลมนั้น ไม่ได้ตั้งใจ
            ไปรันหัวข้อตั้งค่าที่ทำครั้งเดียวจบ */}
        <div className="toolbar" style={{ marginBottom: 20 }}>
          {tabUsesRange ? (
            <>
              <div className="label-group" style={{ gap: 4 }}>
                <label>ช่วงวันที่ที่จะส่งเคลม ตั้งแต่</label>
                <DateField value={from} max={to || undefined} onChange={setFrom} />
              </div>
              <div className="label-group" style={{ gap: 4 }}>
                <label>ถึงวันที่</label>
                <DateField value={to} min={from || undefined} onChange={setTo} />
              </div>
            </>
          ) : null}
          <button
            className="button-primary"
            onClick={() => runTab(currentTab.ids)}
            disabled={runningAll}
            style={{ alignSelf: "flex-end" }}
          >
            {runningAll ? "กำลังตรวจ..." : `ตรวจทั้งหมดในแท็บ${currentTab.label}`}
          </button>
        </div>

        <div className="precheck-list">
          {currentTab.ids.map((id) => {
            const meta = QUERY_CARDS.find((c) => c.id === id);
            return meta ? renderCard(meta) : null;
          })}
        </div>
      </div>

      {fixTarget ? (
        <div className="modal-backdrop" onClick={() => !fixRunning && setFixTarget(null)}>
          <div className="modal-card" style={{ maxWidth: 560, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title" style={{ marginTop: 0 }}>ยืนยันรันคำสั่งแก้ไข (UPDATE)</h2>
            <p style={{ margin: "0 0 8px" }}>
              หัวข้อ: <strong>{CARD_NO[fixTarget.id]}. {fixTarget.title}</strong>
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
