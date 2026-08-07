import { useEffect, useRef, useState } from "react";
import { compareVersion, formatVersion } from "../lib/version";

type DriveVersion = {
  tag: string;
  fileName: string;
  sizeBytes: number;
};

type UpdateInfo = {
  supported: boolean;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
  versions?: DriveVersion[];
};

function formatSize(bytes: number): string {
  if (!bytes) return "";
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** เลขเวอร์ชันพร้อมวันเวลาที่อ่านออก ใช้ในที่ที่มีพื้นที่พอ */
function withDate(tag: string): string {
  const pretty = formatVersion(tag);
  return pretty === tag.replace(/^v/i, "") ? tag : `${tag}  (${pretty})`;
}

/**
 * ขั้นตอนที่หน้าเว็บ "มองเห็นได้จริง" ระหว่างอัปเดต
 *
 * ช่วงดาวน์โหลดเซิร์ฟเวอร์ยังทำงานอยู่ จึงถามสถานะจริงได้ พอถึงช่วงสลับไฟล์
 * เซิร์ฟเวอร์จะถูกปิด อ่านอะไรไม่ได้เลย เราจึงไม่แสร้งทำเป็นรู้ว่าอยู่ขั้นย่อยไหน
 * แต่บอกตรงๆ ว่ากำลังติดตั้งและรอเปิดใหม่ แล้วจับสัญญาณว่ากลับมาแล้วหรือยัง
 */
const STEPS = [
  { key: "downloading", label: "ดาวน์โหลดไฟล์เวอร์ชันใหม่" },
  { key: "installing", label: "ติดตั้งและเปิดโปรแกรมใหม่" },
  { key: "done", label: "เสร็จสมบูรณ์" },
] as const;

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [stagedOnly, setStagedOnly] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [startError, setStartError] = useState("");
  /** เวอร์ชันที่ผู้ใช้เลือกจะติดตั้ง ค่าเริ่มต้นคือตัวใหม่ที่สุด */
  const [selected, setSelected] = useState("");
  const startedAt = useRef(0);

  // ตัวแสดงสถานะเวอร์ชันและปุ่มตรวจเองย้ายไปอยู่แถบเมนูด้านซ้ายแล้ว (VersionCheck)
  // ตรงนี้จึงเหลือหน้าที่เดียวคือขั้นตอนอัปเดต ซึ่งต้องใช้พื้นที่กว้างกว่าที่แถบซ้ายมี
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/update", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.supported) return;
        // ใช้เวอร์ชันล่าสุดอยู่แล้วก็ไม่ต้องแสดงอะไร ไม่งั้นหน้าแรกจะมีการ์ดที่กดแล้ว
        // ไม่เกิดอะไรขึ้นค้างอยู่ทุกวัน — ถ้าต้องถอยกลับไปเวอร์ชันก่อนหน้า ใช้ตัวช่วย
        // ติดตั้งเมนู 1 ซึ่งเลือกเวอร์ชันได้เหมือนกัน
        if (!data.hasUpdate) return;
        setInfo(data);
        setSelected(data.latest || "");
      } catch {
        // ตรวจไม่ได้ก็ไม่ต้องแสดงอะไร แถบซ้ายเป็นคนรายงานความผิดพลาดให้แล้ว
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // นับเวลาที่ผ่านไป เพื่อให้ผู้ใช้เห็นว่าระบบยังเดินอยู่ ไม่ได้ค้าง
  useEffect(() => {
    if (stepIndex < 0 || stepIndex >= STEPS.length - 1) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [stepIndex]);

  async function runUpdate() {
    const target = selected || info?.latest;
    if (!target) return;

    // เตือนให้ชัดเมื่อกำลังจะติดตั้งเวอร์ชันที่เก่ากว่าตัวที่ใช้อยู่ เพราะเป็นการ
    // ย้อนกลับ ไม่ใช่การอัปเดต ผู้ใช้ควรรู้ตัวก่อนว่ากำลังทำอะไร
    const goingBack = !!info?.current && compareVersion(target, info.current) < 0;
    const headline = goingBack
      ? `ย้อนกลับไปเวอร์ชัน ${withDate(target)} ตอนนี้เลยไหม\n\n` +
        `เวอร์ชันที่ใช้อยู่คือ ${withDate(info!.current)} ซึ่งใหม่กว่า`
      : `ติดตั้งเวอร์ชัน ${withDate(target)} ตอนนี้เลยไหม`;

    if (
      !window.confirm(
        `${headline}\n\n` +
          `โปรแกรมจะปิดและเปิดใหม่เอง ผู้ใช้คนอื่นจะใช้งานไม่ได้ราวหนึ่งนาที\n` +
          `ค่าตั้งค่าทั้งหมดจะไม่หาย`
      )
    ) {
      return;
    }

    startedAt.current = Date.now();
    setStepIndex(0);
    setFailed(false);
    setStagedOnly(false);
    setErrorMsg("");
    setStartError("");

    // ต้องตรวจผลของคำสั่งเริ่มอัปเดตด้วย ถ้าเซิร์ฟเวอร์เริ่มให้ไม่ได้ (เช่นเขียนไฟล์
    // สคริปต์ไม่ได้ หรือเปิด PowerShell ไม่ได้) แล้วเราไม่ดูผลลัพธ์ หน้าเว็บจะค้าง
    // อยู่ที่ "ขั้นที่ 1" ตลอดไปโดยไม่บอกสาเหตุอะไรเลย
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStartError(data.error || "เริ่มอัปเดตไม่สำเร็จ");
        setStepIndex(-1);
        return;
      }
    } catch {
      // คำขอขาดกลางคันเป็นเรื่องปกติ เพราะเซิร์ฟเวอร์ถูกปิดระหว่างอัปเดต
      // จึงไม่ถือเป็นความล้มเหลว ปล่อยให้ขั้นตอนถามสถานะทำงานต่อ
    }

    // ถามสถานะทุก 2 วินาที ระหว่างที่เซิร์ฟเวอร์ยังตอบได้
    // พอตอบไม่ได้ = เข้าช่วงสลับไฟล์แล้ว และเมื่อกลับมาพร้อมเวอร์ชันใหม่ = เสร็จ
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/update?stage=1", { cache: "no-store" });
        const data = await res.json();

        if (data.stage === "failed") {
          setFailed(true);
          setErrorMsg(data.error || "");
          clearInterval(poll);
          return;
        }
        if (target && data.current === target) {
          setStepIndex(STEPS.length - 1);
          clearInterval(poll);
          setTimeout(() => window.location.reload(), 1500);
          return;
        }

        // สลับไฟล์เสร็จแล้ว โปรแกรมกลับมาแล้ว แต่เวอร์ชันไม่ขยับ
        //
        // ถ้าไม่ดักกรณีนี้ หน้าเว็บจะรอเวอร์ชันใหม่ที่ไม่มีวันมาถึงจนค้างอยู่ที่ขั้นที่ 2
        // ตลอดไป โดยที่ทุกอย่างรายงานว่าสำเร็จหมด (เจอจริงตอนอัปเดต v2.0.7 เป็น
        // v2.0.8 แล้วแคชของเครือข่ายคืนไฟล์ v2.0.7 กลับมา)
        if (data.stage === "done" && target && data.current && data.current !== target) {
          setFailed(true);
          setErrorMsg(
            `ติดตั้งเสร็จแล้วแต่โปรแกรมยังเป็น ${data.current} ไม่ใช่ ${target} ` +
              `แปลว่าไฟล์ที่ดาวน์โหลดมาเป็นเวอร์ชันเก่า`
          );
          clearInterval(poll);
          return;
        }

        // ไฟล์ใหม่พร้อมแล้วแต่ยังไม่ถูกสลับ แปลว่าเปิดโปรแกรมใหม่อัตโนมัติไม่สำเร็จ
        //
        // ต้องนับ restarting ด้วย เพราะถ้าโปรแกรมสั่งเปิดตัวใหม่แล้วปิดตัวเองสำเร็จจริง
        // เซิร์ฟเวอร์จะตอบไม่ได้ เราจะไม่มีทางอ่านสถานะนี้เจอตั้งแต่แรก การที่ยังอ่านเจอ
        // แปลว่าตัวเก่ายังอยู่ = ไม่มีอะไรเกิดขึ้นจริง
        //
        // ไม่ใช่ความล้มเหลว เพราะการสลับจะเกิดเองตอนเปิดโปรแกรมครั้งถัดไป
        // แค่ต้องบอกผู้ใช้ว่าต้องทำอะไรต่อ ไม่ปล่อยให้รอเก้อ
        if (
          (data.stage === "staged" || data.stage === "restarting") &&
          Date.now() - startedAt.current > 45000
        ) {
          setStagedOnly(true);
          clearInterval(poll);
          return;
        }

        if (data.stage && data.stage !== "downloading") setStepIndex(1);
      } catch {
        // เซิร์ฟเวอร์ปิดอยู่ = กำลังสลับไฟล์ ยังไม่ถือว่าล้มเหลว
        setStepIndex((s) => (s < 1 ? 1 : s));
      }
    }, 2000);
  }

  if (!info) return null;

  const running = stepIndex >= 0;
  const percent = running ? Math.round(((stepIndex + 1) / STEPS.length) * 100) : 0;
  const finished = stepIndex === STEPS.length - 1;
  const versions = info.versions || [];
  // ติดตั้งทับด้วยเวอร์ชันเดียวกับที่ใช้อยู่ไม่ได้ให้อะไรเพิ่ม แต่กินเวลาปิดเปิด
  // โปรแกรมเท่าเดิม จึงปิดปุ่มไว้แทนที่จะปล่อยให้กดแล้วงงว่าทำไมไม่มีอะไรเปลี่ยน
  const sameAsNow = !!selected && selected === info.current;

  return (
    <div className="page-card" style={{ marginBottom: 20 }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          {running ? "กำลังอัปเดตโปรแกรม" : "มีเวอร์ชันใหม่ให้อัปเดต"}
        </h2>
        <span className="status-pill status-pending">{formatVersion(info.latest || "")}</span>
      </div>

      {!running ? (
        <>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            เวอร์ชันที่ใช้อยู่คือ <strong>{info.current ? withDate(info.current) : "(ไม่ทราบ)"}</strong> —
            ไฟล์ติดตั้งดึงจากโฟลเดอร์บน Google Drive ของผู้ดูแล กดแล้วโปรแกรมจะดาวน์โหลด
            ปิดตัวเองและเปิดใหม่โดยอัตโนมัติ ใช้เวลาราวหนึ่งนาที{" "}
            <strong>ค่าตั้งค่าทั้งหมดไม่หาย</strong>
            ถ้าอัปเดตล้มเหลวระบบจะย้อนกลับเป็นเวอร์ชันเดิมให้เอง ควรทำตอนไม่มีคนใช้งาน
          </p>

          {versions.length > 1 ? (
            <div className="label-group" style={{ maxWidth: 420, marginBottom: 14 }}>
              <label htmlFor="version-pick">เลือกเวอร์ชันที่จะติดตั้ง</label>
              <select
                id="version-pick"
                className="input-field"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.tag} value={v.tag}>
                    {/* เลขสิบหลักติดกันเทียบด้วยสายตายาก จึงเติมวันเวลาที่อ่านออกให้ */}
                    {formatVersion(v.tag)}
                    {v.tag === info.latest ? " (ใหม่ที่สุด)" : ""}
                    {v.tag === info.current ? " — ใช้อยู่ตอนนี้" : ""}
                    {v.sizeBytes ? ` · ${formatSize(v.sizeBytes)}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {startError ? (
            <p style={{ color: "#b42318", marginTop: 0 }}>
              {startError} — ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้รันตัวช่วยติดตั้งแล้วเลือกเมนู 1 แทน
            </p>
          ) : null}
          <div className="toolbar">
            <button className="button-primary" onClick={runUpdate} disabled={sameAsNow}>
              {sameAsNow
                ? `ใช้เวอร์ชัน ${formatVersion(selected)} อยู่แล้ว`
                : `ติดตั้งเวอร์ชัน ${formatVersion(selected)}`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "var(--border, #e4e7ec)",
              overflow: "hidden",
              marginBottom: 12,
            }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                width: `${percent}%`,
                height: "100%",
                background: failed ? "#b42318" : stagedOnly ? "#b54708" : "var(--button)",
                transition: "width 0.4s ease",
              }}
            />
          </div>

          {stagedOnly ? (
            <p style={{ marginTop: 0, color: "#b54708" }}>
              ดาวน์โหลดเวอร์ชันใหม่เรียบร้อยแล้ว แต่เปิดโปรแกรมใหม่อัตโนมัติไม่สำเร็จ —
              <strong> ให้ปิดโปรแกรมแล้วเปิดใหม่จากไอคอนบนหน้าจอ ระบบจะเปลี่ยนเป็นเวอร์ชันใหม่ให้เอง</strong>{" "}
              (ไฟล์ใหม่เตรียมไว้ครบแล้ว ค่าตั้งค่าทั้งหมดยังอยู่ ถ้าเครื่องถูกปิดไปก่อนก็ได้เหมือนกัน)
            </p>
          ) : failed ? (
            <p style={{ marginTop: 0, color: "#b42318" }}>
              อัปเดตไม่สำเร็จ {errorMsg ? <strong>{errorMsg}</strong> : null} โปรแกรมยังเป็นเวอร์ชันเดิม
              และใช้งานได้ตามปกติ ไม่มีอะไรเสียหาย ลองใหม่อีกครั้งได้
              ถ้ายังไม่ได้ให้อัปเดตผ่านตัวช่วยติดตั้งแทน โดยรัน ndp-kit-setup.bat แล้วเลือกเมนู 1
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>
                  ขั้นที่ {Math.min(stepIndex + 1, STEPS.length)} จาก {STEPS.length} :{" "}
                  {STEPS[Math.min(stepIndex, STEPS.length - 1)].label}
                </strong>
              </p>
              <p style={{ marginTop: 0, color: "var(--muted)" }}>
                {finished
                  ? "กำลังโหลดหน้าเว็บใหม่..."
                  : stepIndex === 0
                    ? `ผ่านไป ${elapsed} วินาที — ความเร็วขึ้นกับอินเทอร์เน็ตของหน่วยบริการ ระหว่างนี้ยังใช้งานโปรแกรมได้ตามปกติ`
                    : `ผ่านไป ${elapsed} วินาที — โปรแกรมกำลังปิดและเปิดใหม่ หน้าเว็บจะกลับมาเองอัตโนมัติ อย่าเพิ่งปิดหน้านี้`}
              </p>
              {/* ค้างนานผิดปกติ ต้องบอกทางออกไว้ ไม่ปล่อยให้ผู้ใช้เดาว่าควรทำอะไรต่อ */}
              {!finished && elapsed > 180 ? (
                <p style={{ marginTop: 0, color: "var(--muted)" }}>
                  ใช้เวลานานกว่าปกติ อาจเป็นเพราะอินเทอร์เน็ตช้าหรือถูกกันไว้ —
                  ดูรายละเอียดได้ที่ <code>logs\update.log</code> ในโฟลเดอร์โปรแกรม
                  หรือเมนู 3 ของตัวช่วยติดตั้ง ถ้าไม่คืบหน้าให้อัปเดตผ่านตัวช่วยติดตั้งแทน
                  โดยกดเมนู 1 (ปลอดภัย ไฟล์เดิมยังอยู่ครบ)
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
