import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { RefreshIcon } from "./NavIcons";

type UpdateInfo = {
  supported: boolean;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
};

/**
 * ที่เก็บผลการตรวจของรอบการใช้งานนี้ (sessionStorage = ล้างเองเมื่อปิดเบราว์เซอร์)
 *
 * ทำให้ "เข้าใช้งานหนึ่งรอบ = ตรวจหนึ่งครั้ง" ตามที่ต้องการ เพราะแถบเมนูอยู่ทุกหน้า
 * และ VersionCheck ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนหน้า ถ้าไม่เก็บไว้ตรงนี้ การเดินเมนู
 * ไปมาจะกลายเป็นการเรียกตรวจซ้ำทุกหน้า
 */
const CACHE_KEY = "ndp-kit-version-check";

/**
 * อายุของผลที่เก็บไว้ — เครื่องในหน่วยบริการหลายเครื่องเปิดเบราว์เซอร์ค้างไว้ทั้งวัน
 * ไม่เคยปิด ถ้ายึดแค่ "หนึ่งรอบเบราว์เซอร์" เครื่องพวกนั้นจะไม่มีวันรู้ว่ามีเวอร์ชันใหม่
 * เลยจนกว่าจะมีคนกดปุ่มเอง จึงให้หมดอายุใน 12 ชั่วโมงเป็นตาข่ายรองอีกชั้น
 */
const SESSION_CACHE_MS = 12 * 60 * 60 * 1000;

function readSessionCache(): UpdateInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UpdateInfo & { checkedAt?: number };
    if (!parsed.checkedAt || Date.now() - parsed.checkedAt > SESSION_CACHE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(info: UpdateInfo): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...info, checkedAt: Date.now() }));
  } catch {
    // เบราว์เซอร์ปิด sessionStorage ไว้ก็แค่กลับไปตรวจทุกครั้งที่เปลี่ยนหน้าเหมือนเดิม
  }
}

/**
 * สถานะเวอร์ชันในแถบเมนูด้านซ้าย
 *
 * อยู่ตรงนี้เพราะแถบซ้ายเห็นได้ทุกหน้า ไม่ต้องกลับไปหน้าแรกเพื่อจะรู้ว่ามีของใหม่
 * ส่วนตัวขั้นตอนอัปเดตยังอยู่ที่หน้าแรก (UpdateBanner) เพราะแถบกว้าง 240px แสดง
 * แถบความคืบหน้าสามขั้นพร้อมคำอธิบายไม่ไหว ถ้าเจอเวอร์ชันใหม่จากหน้าอื่นจึงพาไป
 * หน้าแรกให้แทน
 *
 * ตรวจแค่ครั้งเดียวต่อการเข้าใช้งานหนึ่งรอบ (ครั้งแรกหลังเข้าสู่ระบบ) หลังจากนั้น
 * ใช้ผลเดิมตลอด จนกว่าผู้ใช้จะกดปุ่มตรวจเอง
 *
 * เหตุผล: เพดานจำนวนครั้งของ GitHub นับต่อหมายเลข IP ไม่ใช่ต่อเครื่อง หน่วยบริการ
 * ที่ลงหลายเครื่องออกเน็ตผ่าน IP เดียวกันจะแชร์โควตาก้อนเดียวทั้งหน่วย การตรวจ
 * ทุกครั้งที่เปลี่ยนหน้าจึงกินโควตาเปล่าโดยไม่ได้ประโยชน์ — เวอร์ชันใหม่ออกไม่กี่ครั้ง
 * ต่อสัปดาห์ ไม่มีเหตุต้องรู้เร็วกว่านี้ (ฝั่งเซิร์ฟเวอร์ยังพักผลไว้อีก 6 ชั่วโมงซ้อนอยู่)
 */
export default function VersionCheck() {
  const router = useRouter();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const check = useCallback(async (manual: boolean) => {
    if (manual) setChecking(true);
    setError("");
    try {
      const res = await fetch(`/api/update${manual ? "?force=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `เซิร์ฟเวอร์ตอบกลับรหัส ${res.status}`);
      setInfo(data);
      writeSessionCache(data);
    } catch (err: any) {
      setError(err?.message || "ตรวจสอบไม่สำเร็จ");
    } finally {
      setLoaded(true);
      if (manual) setChecking(false);
    }
  }, []);

  useEffect(() => {
    // ตรวจแล้วในรอบนี้ก็ใช้ผลเดิม ไม่เรียกซ้ำ
    const cached = readSessionCache();
    if (cached) {
      setInfo(cached);
      setLoaded(true);
      return;
    }
    void check(false);
  }, [check]);

  if (!loaded) return null;

  const hasUpdate = !!(info && info.supported && info.hasUpdate);

  return (
    <div className="version-check">
      {hasUpdate ? (
        // อยู่หน้าแรกอยู่แล้วก็ไม่ต้องพาไปไหน แบนเนอร์อัปเดตอยู่ตรงหน้าแล้ว
        router.pathname === "/" ? (
          <span className="version-check-new">มีเวอร์ชันใหม่ {info?.latest}</span>
        ) : (
          <Link href="/" className="version-check-new">
            มีเวอร์ชันใหม่ {info?.latest} →
          </Link>
        )
      ) : (
        <span className="version-check-status">
          {error ? error : info && !info.supported ? "อัปเดตจากหน้าเว็บไม่ได้" : "ใช้เวอร์ชันล่าสุดแล้ว"}
        </span>
      )}
      <button
        type="button"
        className="version-check-btn"
        onClick={() => check(true)}
        disabled={checking}
        title="ตรวจสอบเวอร์ชันใหม่"
        aria-label="ตรวจสอบเวอร์ชันใหม่"
      >
        <RefreshIcon size={15} />
        {checking ? "กำลังตรวจ..." : "ตรวจสอบเวอร์ชัน"}
      </button>
    </div>
  );
}
