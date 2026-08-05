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
 * สถานะเวอร์ชันในแถบเมนูด้านซ้าย
 *
 * อยู่ตรงนี้เพราะแถบซ้ายเห็นได้ทุกหน้า ไม่ต้องกลับไปหน้าแรกเพื่อจะรู้ว่ามีของใหม่
 * ส่วนตัวขั้นตอนอัปเดตยังอยู่ที่หน้าแรก (UpdateBanner) เพราะแถบกว้าง 240px แสดง
 * แถบความคืบหน้าสามขั้นพร้อมคำอธิบายไม่ไหว ถ้าเจอเวอร์ชันใหม่จากหน้าอื่นจึงพาไป
 * หน้าแรกให้แทน
 *
 * ผลการถามถูกพักไว้ฝั่งเซิร์ฟเวอร์ห้านาที (ดู fetchLatestVersion) การเปลี่ยนหน้า
 * ไปมาจึงไม่ยิงถาม GitHub ซ้ำจนชนเพดานจำนวนครั้ง ส่วนปุ่มที่ผู้ใช้กดเองจะถามสด
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
    } catch (err: any) {
      setError(err?.message || "ตรวจสอบไม่สำเร็จ");
    } finally {
      setLoaded(true);
      if (manual) setChecking(false);
    }
  }, []);

  useEffect(() => {
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
