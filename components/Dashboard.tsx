import Link from "next/link";
import { useEffect, useState } from "react";

interface Summary {
  today: string;
  visitsToday: number;
  peopleToday: number;
  monthLabel: string;
  visitsMonth: number;
  peopleMonth: number;
  bahtMonth: number;
  visitsPrevMonth: number;
  bahtPrevMonth: number;
  byPttype: { name: string; visits: number }[];
  byIncome: { name: string; baht: number }[];
  trend: { ym: string; visits: number; baht: number }[];
  topDiagnoses: { code: string; name: string; count: number }[];
  atRiskBaht: number;
  atRiskItems: number;
  atRiskDrugs: number;
  drugBahtMonth: number;
}

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-06" -> "มิ.ย. 69" — ผู้ใช้อ่าน พ.ศ. ไม่ใช่ ค.ศ. */
function thaiMonth(ym: string): string {
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  const name = THAI_MONTHS[(m || 1) - 1] || ym;
  return `${name} ${String((y || 0) + 543).slice(-2)}`;
}

function baht(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** ข้อความเทียบกับเดือนที่แล้ว เช่น "+18 จากเดือนที่แล้ว" */
function compare(now: number, prev: number): string {
  if (!prev) return "";
  const diff = now - prev;
  if (diff === 0) return "เท่ากับเดือนที่แล้ว";
  const pct = Math.round((Math.abs(diff) / prev) * 100);
  return `${diff > 0 ? "▲" : "▼"} ${baht(Math.abs(diff))} (${pct}%) จากเดือนที่แล้ว`;
}

/**
 * สรุปภาพรวมสำหรับผู้บริหารบนหน้าแรก
 *
 * โหลดหลังหน้าขึ้นแล้ว ไม่บล็อกหน้าแรก และถ้าอ่านฐานไม่ได้ก็ไม่แสดงอะไรเลย
 * แทนที่จะขึ้นข้อความผิดพลาดคาหน้าแรกทุกวัน — เครื่องที่ยังไม่ได้ตั้งค่าฐาน
 * จะเห็นแค่ปุ่มเมนูตามปกติ ซึ่งเป็นสิ่งที่ต้องทำก่อนอยู่แล้ว
 */
export default function Dashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // เงียบไว้ ปุ่มเมนูยังใช้ได้ตามปกติ
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) return null;

  const maxVisits = Math.max(1, ...data.trend.map((t) => t.visits));
  const maxPttype = Math.max(1, ...data.byPttype.map((p) => p.visits));
  const maxIncome = Math.max(1, ...data.byIncome.map((i) => i.baht));
  const hasAny =
    data.visitsMonth > 0 || data.bahtMonth > 0 || data.trend.some((t) => t.visits > 0);

  return (
    <section className="dash">
      <div className="dash-tiles">
        <div className="dash-tile">
          <span className="dash-tile-label">ผู้รับบริการวันนี้</span>
          <span className="dash-tile-value">{baht(data.visitsToday)}</span>
          <span className="dash-tile-sub">{baht(data.peopleToday)} คน</span>
        </div>
        <div className="dash-tile">
          <span className="dash-tile-label">ผู้รับบริการเดือนนี้</span>
          <span className="dash-tile-value">{baht(data.visitsMonth)}</span>
          <span className="dash-tile-sub">
            {baht(data.peopleMonth)} คน · {compare(data.visitsMonth, data.visitsPrevMonth) || "—"}
          </span>
        </div>
        <div className="dash-tile">
          <span className="dash-tile-label">ค่าบริการเดือนนี้</span>
          <span className="dash-tile-value">{baht(data.bahtMonth)}</span>
          <span className="dash-tile-sub">
            บาท · {compare(data.bahtMonth, data.bahtPrevMonth) || "—"}
          </span>
        </div>

        {/* เงินที่จ่ายออกไปแล้วแต่เบิกคืนไม่ได้ — เน้นสีเหลืองตามกติกาสีของโปรเจ็ค
            (ยังไม่ผิด แต่ต้องรีบตรวจ) และลิงก์ไปหน้าที่แก้ได้ทันที */}
        <div className={`dash-tile${data.atRiskBaht > 0 ? " dash-tile-warn" : ""}`}>
          <span className="dash-tile-label">ยาที่เบิกไม่ได้เดือนนี้</span>
          <span className="dash-tile-value">{baht(data.atRiskBaht)}</span>
          <span className="dash-tile-sub">
            {data.atRiskBaht > 0 ? (
              <>
                บาท · ยา {baht(data.atRiskDrugs)} รายการ
                {data.drugBahtMonth > 0
                  ? ` (${Math.round((data.atRiskBaht / data.drugBahtMonth) * 100)}% ของค่ายาทั้งเดือน)`
                  : ""}
                {" · "}
                <Link href="/ndp-precheck?tab=master" className="dash-link">
                  ดูรายการที่ต้องแก้
                </Link>
              </>
            ) : (
              "บาท · ยาที่จ่ายเดือนนี้มีรหัส TMT ครบแล้ว"
            )}
          </span>
        </div>
      </div>

      {!hasAny ? (
        <p className="dash-empty">
          ยังไม่มีข้อมูลผู้รับบริการในเดือนนี้ — ตัวเลขจะขึ้นเองเมื่อมีการบันทึกบริการใน HOSxP
        </p>
      ) : (
        <div className="dash-panels">
          <div className="dash-panel">
            <h3 className="dash-panel-title">แนวโน้มผู้รับบริการ 6 เดือน</h3>
            <div className="dash-bars">
              {data.trend.map((t) => (
                <div className="dash-bar-col" key={t.ym} title={`${baht(t.visits)} ครั้ง · ${baht(t.baht)} บาท`}>
                  <span className="dash-bar-num">{baht(t.visits)}</span>
                  <div className="dash-bar-track">
                    <div
                      className="dash-bar-fill"
                      style={{ height: `${Math.round((t.visits / maxVisits) * 100)}%` }}
                    />
                  </div>
                  <span className="dash-bar-label">{thaiMonth(t.ym)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="dash-panel">
            <h3 className="dash-panel-title">สิทธิการรักษาเดือนนี้</h3>
            {data.byPttype.length === 0 ? (
              <p className="dash-empty">ไม่มีข้อมูล</p>
            ) : (
              <ul className="dash-list">
                {data.byPttype.map((p) => (
                  <li className="dash-list-row" key={p.name}>
                    <span className="dash-list-name" title={p.name}>{p.name}</span>
                    <span className="dash-list-track">
                      <span
                        className="dash-list-fill"
                        style={{ width: `${Math.round((p.visits / maxPttype) * 100)}%` }}
                      />
                    </span>
                    <span className="dash-list-value">{baht(p.visits)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dash-panel">
            <h3 className="dash-panel-title">วินิจฉัยที่พบบ่อยเดือนนี้</h3>
            {data.topDiagnoses.length === 0 ? (
              <p className="dash-empty">ไม่มีข้อมูล</p>
            ) : (
              <ol className="dash-dx">
                {data.topDiagnoses.map((d, i) => (
                  <li className="dash-dx-row" key={`${d.code}-${i}`}>
                    <span className="dash-dx-no">{i + 1}</span>
                    <span className="dash-dx-code">{d.code}</span>
                    <span className="dash-dx-name" title={d.name}>{d.name}</span>
                    <span className="dash-list-value">{baht(d.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="dash-panel">
            <h3 className="dash-panel-title">ค่าบริการแยกตามหมวดเดือนนี้</h3>
            {data.byIncome.length === 0 ? (
              <p className="dash-empty">ไม่มีข้อมูล</p>
            ) : (
              <ul className="dash-list">
                {data.byIncome.map((i) => (
                  <li className="dash-list-row" key={i.name}>
                    <span className="dash-list-name" title={i.name}>{i.name}</span>
                    <span className="dash-list-track">
                      <span
                        className="dash-list-fill"
                        style={{ width: `${Math.round((i.baht / maxIncome) * 100)}%` }}
                      />
                    </span>
                    <span className="dash-list-value">{baht(i.baht)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <p className="dash-note">
        ตัวเลขอ่านจากฐาน HOSxP โดยตรง ณ เวลาที่เปิดหน้านี้ · ยอดเงินเป็นค่าบริการที่บันทึกไว้
        ยังไม่ใช่ยอดที่เบิกได้จริง
      </p>
    </section>
  );
}
