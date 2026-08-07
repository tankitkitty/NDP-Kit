import { GetServerSideProps } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Layout from "../../components/Layout";
import PrecheckSections from "../../components/PrecheckSections";
import { getHospitalName } from "../../lib/db";
import { getCheck } from "../../lib/precheck";
import { getSession } from "../../lib/session";
import type { CheckOutcome } from "../../lib/precheck/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * หน้ารายละเอียดผลตรวจของหัวข้อเดียว
 *
 * เดิมกางรายละเอียดต่อท้ายการ์ดในหน้ารวม ซึ่งพอตารางมีเป็นร้อยแถวพร้อมคำแนะนำยาวๆ
 * หน้าจะยืดจนต้องเลื่อนผ่านการ์ดอื่นทั้งหมดกว่าจะถึงใบถัดไป และพอกางหลายใบพร้อมกัน
 * ก็หาไม่เจอว่าอ่านถึงไหนแล้ว แยกเป็นคนละหน้าจึงเห็นทีละเรื่องและกดกลับได้
 *
 * โหลดชื่อหัวข้อฝั่งเซิร์ฟเวอร์เพื่อให้หัวหน้าจอขึ้นทันที ส่วนผลตรวจยังเรียกผ่าน API
 * ตอนเปิดหน้าเหมือนเดิม เพราะบางหัวข้อใช้เวลาหลายวินาที ถ้ารอให้เสร็จก่อนค่อยส่ง
 * หน้ามา ผู้ใช้จะเจอจอขาวโดยไม่รู้ว่าระบบทำงานอยู่
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  const id = typeof context.params?.id === "string" ? context.params.id : "";
  const check = getCheck(id);
  if (!check) {
    return { redirect: { destination: "/ndp-precheck", permanent: false } };
  }

  const hospitalName = await getHospitalName();
  return {
    props: {
      id,
      title: check.title,
      description: check.description,
      needsRange: check.needsRange === true,
      loginname: session.loginname,
      hospitalName,
    },
  };
};

export default function PrecheckDetailPage({
  id,
  title,
  description,
  needsRange,
  loginname,
  hospitalName,
}: {
  id: string;
  title: string;
  description: string;
  needsRange: boolean;
  loginname: string;
  hospitalName: string;
}) {
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  /** แท็บที่ผู้ใช้เปิดอยู่ตอนกดเข้ามา ใช้พากลับไปที่เดิม */
  const [fromTab, setFromTab] = useState("");

  // เปิดหน้าต่างยืนยันก่อนรันคำสั่งแก้ไข (มีเฉพาะหัวข้อที่ระบบรันแก้ให้ได้)
  const [fixOpen, setFixOpen] = useState(false);
  const [fixBackupAck, setFixBackupAck] = useState(false);
  const [fixRunning, setFixRunning] = useState(false);
  const [fixMessage, setFixMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = useCallback(
    async (from: string, to: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ check: id });
        if (from && to) {
          params.set("from", from);
          params.set("to", to);
        }
        const res = await fetch(`/api/precheck/run?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "ตรวจสอบไม่สำเร็จ");
          setOutcome(null);
          return;
        }
        setOutcome(data);
      } catch {
        setError("เรียก API ไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  // ช่วงวันที่และแท็บส่งต่อมาจากหน้ารวมทาง query string
  // ช่วงวันที่ทำให้ผลที่เห็นตรงกับที่หน้ารวมตรวจไว้ ส่วนแท็บใช้ตอนกดกลับ
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const valid = DATE_PATTERN.test(from) && DATE_PATTERN.test(to);
    setRange({ from: valid ? from : "", to: valid ? to : "" });
    // รับเฉพาะรูปแบบที่เป็นชื่อแท็บได้จริง ไม่เอาค่าจาก URL ไปต่อท้ายลิงก์ตรงๆ
    const tab = q.get("tab") || "";
    setFromTab(/^[a-z0-9-]{1,32}$/i.test(tab) ? tab : "");
    void run(valid ? from : "", valid ? to : "");
  }, [run]);

  async function executeFix() {
    setFixRunning(true);
    setFixMessage(null);
    try {
      const res = await fetch("/api/precheck/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId: id, confirm: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setFixMessage({ text: data.message || "แก้ไขสำเร็จ", error: false });
        await run(range.from, range.to);
      } else {
        setFixMessage({ text: data.error || "รันคำสั่งแก้ไขไม่สำเร็จ", error: true });
      }
    } catch {
      setFixMessage({ text: "เรียก API ไม่สำเร็จ", error: true });
    } finally {
      setFixRunning(false);
    }
  }

  // กลับไปหน้ารวมโดยพาช่วงวันที่และแท็บเดิมกลับไปด้วย
  // ไม่งั้นผู้ใช้ต้องเลือกวันที่ใหม่ และเด้งกลับไปแท็บแรกทุกครั้งที่กดกลับ
  const backHref = (() => {
    const params = new URLSearchParams();
    if (range.from && range.to) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    if (fromTab) params.set("tab", fromTab);
    const qs = params.toString();
    return qs ? `/ndp-precheck?${qs}` : "/ndp-precheck";
  })();

  const statusText = !outcome
    ? ""
    : outcome.status === "pass"
      ? "✅ ผ่าน"
      : outcome.status === "issues"
        ? `⚠️ พบ ${outcome.problemCount.toLocaleString()} รายการ`
        : outcome.status === "unavailable"
          ? "ตรวจไม่ได้"
          : outcome.status === "empty"
            ? "ไม่มีข้อมูลให้ตรวจ"
            : "ข้อมูลประกอบ";

  return (
    <Layout title={title} loginname={loginname} hospitalName={hospitalName} fullWidth>
      <Link href={backHref} className="button-ghost" style={{ marginBottom: 16, display: "inline-flex" }}>
        ← กลับไปหน้าตรวจก่อนส่งเคลม
      </Link>

      <h1 className="page-title" style={{ marginBottom: 6 }}>{title}</h1>
      <p className="brand-subtitle" style={{ margin: "0 0 4px", maxWidth: 900, lineHeight: 1.6 }}>
        {description}
      </p>
      {needsRange && range.from && range.to ? (
        <p className="brand-subtitle" style={{ margin: "0 0 16px", fontSize: 12 }}>
          ช่วงวันที่ {range.from} ถึง {range.to}
        </p>
      ) : (
        <div style={{ height: 16 }} />
      )}

      <div className="toolbar" style={{ marginBottom: 20 }}>
        <button className="button-primary" onClick={() => void run(range.from, range.to)} disabled={loading}>
          {loading ? "กำลังตรวจ..." : "ตรวจซ้ำ"}
        </button>
        {outcome?.canExecuteFix ? (
          <button
            className="button-ghost"
            onClick={() => {
              setFixOpen(true);
              setFixBackupAck(false);
              setFixMessage(null);
            }}
          >
            รันคำสั่งแก้ไขจากระบบ...
          </button>
        ) : null}
      </div>

      {error ? <div className="status-message status-error">{error}</div> : null}

      {loading ? (
        <p>กำลังตรวจสอบ...</p>
      ) : outcome ? (
        <>
          <div
            className={
              outcome.status === "pass"
                ? "state-ok"
                : outcome.status === "issues" || outcome.status === "unavailable"
                  ? "state-alert"
                  : ""
            }
            style={{ padding: "12px 14px", marginBottom: 20 }}
          >
            <strong>{statusText}</strong> — {outcome.summary}
          </div>

          {outcome.error ? (
            <div className="status-message status-error" style={{ marginBottom: 12 }}>
              {outcome.error}
            </div>
          ) : null}

          <PrecheckSections cardTitle={title} sections={outcome.sections} />

          {outcome.advice ? (
            <div className="precheck-advice" style={{ marginTop: 24 }}>
              <div className="precheck-section-title">คำแนะนำการแก้ไข</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{outcome.advice}</p>
            </div>
          ) : null}
        </>
      ) : null}

      {fixOpen ? (
        <div className="modal-backdrop" onClick={() => !fixRunning && setFixOpen(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: 560, textAlign: "left" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title" style={{ marginTop: 0 }}>ยืนยันรันคำสั่งแก้ไข (UPDATE)</h2>
            <p style={{ margin: "0 0 8px" }}>
              หัวข้อ: <strong>{title}</strong>
            </p>
            <div className="status-message status-error" style={{ marginBottom: 12 }}>
              ⚠ ตาราง HOSxP เป็น MyISAM ไม่มี transaction — รันแล้ว<strong>ย้อนกลับไม่ได้</strong> ควรสำรองตารางก่อน เช่น<br />
              <code style={{ fontSize: "0.85rem" }}>CREATE TABLE person_deformed_bak AS SELECT * FROM person_deformed;</code>
            </div>
            <pre className="sql-block">{outcome?.fixSql}</pre>
            <label className="precheck-check-item" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={fixBackupAck}
                onChange={(e) => setFixBackupAck(e.target.checked)}
              />
              <span>ฉันได้สำรองข้อมูลตารางที่เกี่ยวข้องแล้ว และเข้าใจว่าการแก้ไขนี้ย้อนกลับไม่ได้</span>
            </label>
            {fixMessage ? (
              <div
                className={`status-message ${fixMessage.error ? "status-error" : "status-success"}`}
                style={{ marginTop: 12 }}
              >
                {fixMessage.text}
              </div>
            ) : null}
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="button-ghost" onClick={() => setFixOpen(false)} disabled={fixRunning}>
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
