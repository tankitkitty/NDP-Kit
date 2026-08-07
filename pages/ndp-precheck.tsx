import { useEffect, useState } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
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
  { id: "drug-catalog", title: "รหัสยาเทียบ Drug Catalog / TMT", description: "drugitems.sks_drug_code และราคา ต้องตรงกับ TMT/ราคาใน Drug Catalog รายการล่าสุด" },
  { id: "service-price", title: "ราคาที่คีย์จริงเทียบราคาตั้งต้น", description: "opitemrece.unitprice เทียบ drugitems.unitprice ในช่วงวันที่ที่เลือก", needsRange: true },
  { id: "auth-code", title: "เคสที่ยังไม่มีเลขปิดสิทธิ (Authorization)", description: "visit ในช่วงวันที่ที่เลือกที่ยังไม่มี auth_code — ต้องปิดสิทธิ/ออกใบแจ้งหนี้ก่อนส่งเคลม", needsRange: true },
  { id: "claim-log", title: "ประวัติการส่งเคลมล่าสุด", description: "ค้นหาตาราง log การส่ง NDP/eClaim ในฐานอัตโนมัติ แล้วแสดงรายการส่งล่าสุดพร้อม error (ถ้ามี)" },
  { id: "spclty-nhso-code", title: "รหัสแผนกของ สปสช. (spclty.nhso_code)", description: "แสดงการ map แผนกทั้งหมดกับรหัส สปสช. เน้นสีแดงแถวที่รหัสไม่ใช่ 01-12 และสีเหลืองแถวที่ชื่อแผนกดูไม่ตรงกับรหัส" },
  { id: "postnatal-care", title: "บริการตรวจหลังคลอด (ICD-10 Z39 + ADP 30015)", description: "เคสตรวจหลังคลอดต้องมีทั้ง ICD-10 Z390/Z391/Z392 และรายการค่าบริการรหัส ADP 30015 — ขาดอย่างใดอย่างหนึ่งเบิกไม่ได้", needsRange: true },
  { id: "triferdine", title: "บริการจ่ายยา Triferdine (ICD-10 Z392 + ADP 30016)", description: "เคสจ่ายยา Triferdine ต้องมีครบทั้ง ICD-10 Z392, ค่าบริการรหัส ADP 30016 และรายการยารหัส 737390 หรือ 689609", needsRange: true },
  { id: "pregnancy-test", title: "บริการชุดทดสอบการตั้งครรภ์ (ICD-10 Z32 + ADP 30014/30017/31101)", description: "เคสชุดทดสอบการตั้งครรภ์ต้องมีทั้ง ICD-10 Z320 หรือ Z321 และค่าบริการรหัส ADP 30014 / 30017 หรือ CSMBS 31101", needsRange: true },
  { id: "contraceptive", title: "บริการยาเม็ดและยาฉีดคุมกำเนิด (ICD-10 Z304 + รหัส TMT)", description: "เคสคุมกำเนิดต้องมีทั้ง ICD-10 Z304 และรายการยาที่ตั้งรหัส TMT ตรงตามที่ สปสช. กำหนด (23 รหัส)", needsRange: true },
  { id: "hpv-screening", title: "คัดกรองมะเร็งปากมดลูก HPV ค่าเก็บตัวอย่าง (Z115 + 9146 + 38608)", description: "เคสคัดกรองมะเร็งปากมดลูกต้องมีครบทั้ง ICD-10 Z115, ICD-9-CM 9146 และค่าบริการรหัส CSMBS 38608", needsRange: true },
  { id: "diabetes-screening", title: "คัดกรองเบาหวานกลุ่มเสี่ยง (Z018 + TLMT/CSMBS/NHSO)", description: "เคสคัดกรองเบาหวานต้องมี ICD-10 Z018 และมีอย่างใดอย่างหนึ่งใน TMLT 320281 (แล็บ), CSMBS 32203 หรือ NHSO 12003", needsRange: true },
  { id: "cholesterol-screening", title: "คัดกรอง Total Cholesterol + HDL อายุ 35 ปีขึ้นไป (Z108)", description: "เคสคัดกรองไขมันต้องมี ICD-10 Z108 และมีอย่างใดอย่างหนึ่งใน GPU 31001, TMLT 320259 (แล็บ), CSMBS 32004 หรือ NHSO 12004", needsRange: true },
  { id: "condom", title: "บริการถุงยางพร้อมให้คำปรึกษา (ICD-10 Z30 + bill code)", description: "เคสถุงยางพร้อมให้คำปรึกษาต้องมีทั้ง ICD-10 Z30/Z300/Z304/Z309 และรายการค่าบริการ bill code 6201001/6201005/6201006/6201007", needsRange: true },
  { id: "anemia-screening", title: "คัดกรองโลหิตจางจากการขาดธาตุเหล็ก CBC หญิง 13-24 ปี (Z130)", description: "เคสหญิงอายุ 13-24 ปีที่ไม่ตั้งครรภ์ ต้องมี ICD-10 Z130 และมีอย่างใดอย่างหนึ่งใน TMLT 300034/300035 (แล็บ) หรือ CSMBS 30101/30102/13001", needsRange: true },
  { id: "iron-supplement", title: "บริการจ่ายยาเม็ดเสริมธาตุเหล็ก Ferrofolic (Z130 + รหัส TMT)", description: "เคสจ่ายยาเสริมธาตุเหล็กต้องมีทั้ง ICD-10 Z130 และรายการยาที่ตั้งรหัส TMT ตรงกับ GPU 10 รหัสที่ สปสช. กำหนด", needsRange: true },
  { id: "drug-tmt-missing", title: "ยาที่ยังไม่ได้กำหนดรหัส TMT (สกส.)", description: "ยาที่ช่อง sks_drug_code ยังว่างอยู่จะส่งออกไป NDP ไม่ได้ เบิกไม่ได้ทั้งที่จ่ายยาไปจริง" },
  { id: "drug-income", title: "ยาที่ยังไม่ใส่หมวดค่าบริการ หรือไม่ใช่รหัส 03", description: "รายการยาผู้ป่วยนอกควรตั้งหมวดค่าบริการเป็น 03 ถ้าตั้งเป็นหมวดอื่นยอดจะไปโผล่ผิดช่องในใบเบิก" },
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
    ids: ["auth-code", "postnatal-care", "triferdine", "pregnancy-test", "contraceptive", "condom", "hpv-screening", "diabetes-screening", "cholesterol-screening", "anemia-screening", "iron-supplement", "claim-log"],
  },
  {
    key: "master",
    label: "ข้อมูลตั้งต้นและการตั้งค่า",
    hint: "ตั้งครั้งเดียวแล้วใช้ได้ตลอด — ทะเบียนผู้ป่วย บุคลากร สิทธิ รหัสแผนก และทะเบียนยา",
    ids: ["deformed-no", "po-code", "provider", "pttype-config", "spclty-nhso-code", "drug-tmt-missing", "drug-income"],
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** ที่เก็บผลตรวจของรอบการใช้งานนี้ ให้กดกลับจากหน้ารายละเอียดแล้วผลยังอยู่ */
const RESULT_CACHE_KEY = "ndp-kit-precheck-results";

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
  // เปิดแท็บตามที่ลิงก์ระบุมา เช่น /ndp-precheck?tab=master จากหน้า setup-checklist
  // ต้องทำใน effect ไม่ใช่ค่าเริ่มต้นของ useState เพราะ router.query ยังว่างตอน render แรก
  const router = useRouter();
  useEffect(() => {
    const wanted = router.query.tab;
    if (typeof wanted === "string" && TABS.some((t) => t.key === wanted)) setActiveTab(wanted);
  }, [router.query.tab]);

  /**
   * คืนช่วงวันที่และผลตรวจเดิมเมื่อกดกลับมาจากหน้ารายละเอียด
   *
   * ผลตรวจบางหัวข้อใช้เวลาหลายวินาที ถ้ากลับมาแล้วต้องกด "ตรวจทั้งหมด" ใหม่ทุกครั้ง
   * จะเสียเวลาซ้ำโดยไม่จำเป็น และผู้ใช้ที่ไล่ดูรายละเอียดทีละใบต้องรอใหม่ทุกใบ
   *
   * เก็บใน sessionStorage (ล้างเองเมื่อปิดเบราว์เซอร์) โดย **ตัดแถวข้อมูลออก**
   * เหลือแต่หัวตารางและบทสรุป เพราะหน้ารวมใช้แค่สถานะกับข้อความสรุป ส่วนตารางจริง
   * หน้ารายละเอียดตรวจใหม่เองอยู่แล้ว — ถ้าเก็บทุกแถวจะเกินโควตาของ sessionStorage
   * ทันทีที่มีการ์ดที่คืนผลเป็นพันแถว แล้วจะกลายเป็นเก็บไม่ได้เลยสักใบ
   */
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    const qFrom = typeof q.from === "string" && DATE_PATTERN.test(q.from) ? q.from : "";
    const qTo = typeof q.to === "string" && DATE_PATTERN.test(q.to) ? q.to : "";
    if (qFrom) setFrom(qFrom);
    if (qTo) setTo(qTo);

    try {
      const raw = sessionStorage.getItem(RESULT_CACHE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { from: string; to: string; cards: Record<string, CardState> };
      // ผลเก่าของคนละช่วงวันที่ใช้ไม่ได้ ต้องทิ้ง ไม่งั้นตัวเลขบนการ์ดจะไม่ตรงกับวันที่ที่แสดง
      const targetFrom = qFrom || saved.from;
      const targetTo = qTo || saved.to;
      if (saved.from !== targetFrom || saved.to !== targetTo) return;
      if (!qFrom) setFrom(saved.from);
      if (!qTo) setTo(saved.to);
      setCards(saved.cards || {});
    } catch {
      // อ่านไม่ได้ก็แค่เริ่มต้นใหม่ ไม่ใช่เรื่องที่ต้องแจ้งผู้ใช้
    }
  }, [router.isReady, router.query]);

  // modal ยืนยันก่อนรัน UPDATE (แยกจากปุ่มอื่นเสมอ เพราะรันแล้วย้อนกลับไม่ได้)
  const [fixTarget, setFixTarget] = useState<CardMeta | null>(null);
  const [fixBackupAck, setFixBackupAck] = useState(false);
  const [fixRunning, setFixRunning] = useState(false);
  const [fixMessage, setFixMessage] = useState<{ text: string; error: boolean } | null>(null);

  /**
   * เก็บผลตรวจไว้ให้กดกลับมาแล้วยังอยู่
   *
   * ตัดแถวข้อมูลออกก่อนเก็บ (rows: []) เพราะหน้ารวมใช้แค่สถานะกับข้อความสรุป
   * ส่วนตารางจริงหน้ารายละเอียดตรวจใหม่เอง — ถ้าเก็บทุกแถวจะเกินโควตาทันที
   * ที่มีการ์ดคืนผลเป็นพันแถว แล้วจะเก็บไม่ได้เลยสักใบ
   */
  useEffect(() => {
    if (Object.keys(cards).length === 0) return;
    try {
      const slim: Record<string, CardState> = {};
      for (const [id, state] of Object.entries(cards)) {
        // การ์ดที่กำลังตรวจอยู่ไม่ต้องเก็บสถานะ loading ไว้ ไม่งั้นกลับมาจะค้างที่ "กำลังตรวจ"
        if (state.loading) continue;
        slim[id] = {
          ...state,
          loading: false,
          outcome: state.outcome
            ? { ...state.outcome, sections: state.outcome.sections.map((s) => ({ ...s, rows: [] })) }
            : null,
        };
      }
      sessionStorage.setItem(RESULT_CACHE_KEY, JSON.stringify({ from, to, cards: slim }));
    } catch {
      // เก็บไม่ได้ (โควตาเต็ม/ปิด sessionStorage) ก็แค่ต้องตรวจใหม่เมื่อกลับมา
    }
  }, [cards, from, to]);

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
            {/* รายละเอียดไปอยู่หน้าของตัวเอง ไม่กางต่อท้ายการ์ดแล้ว เพราะตารางบางหัวข้อ
                มีเป็นร้อยแถวพร้อมคำแนะนำยาวๆ พอกางแล้วต้องเลื่อนผ่านทั้งหมดกว่าจะถึง
                การ์ดใบถัดไป และกางหลายใบพร้อมกันแล้วหาไม่เจอว่าอ่านถึงไหน
                พาช่วงวันที่ไปด้วยเพื่อให้หน้ารายละเอียดตรวจด้วยเงื่อนไขเดียวกัน
                และพาแท็บที่เปิดอยู่ไปด้วย เพื่อให้กดกลับมาแล้วอยู่แท็บเดิม */}
            {outcome && (outcome.sections.length > 0 || outcome.advice || outcome.error) ? (
              <Link
                className="button-ghost precheck-small-btn"
                href={`/ndp-precheck/${encodeURIComponent(meta.id)}?from=${from}&to=${to}&tab=${activeTab}`}
              >
                ดูรายละเอียด →
              </Link>
            ) : null}
          </div>
        </div>
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
