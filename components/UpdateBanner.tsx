import { useEffect, useState } from "react";

type UpdateInfo = {
  supported: boolean;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
};

/**
 * แถบแจ้งเตือนเวอร์ชันใหม่บนหน้าหลัก
 *
 * จะไม่แสดงอะไรเลยเมื่อใช้เวอร์ชันล่าสุดอยู่แล้ว เพื่อไม่ให้หน้าหลักรกด้วยข้อมูล
 * ที่ผู้ใช้ไม่ต้องทำอะไรกับมัน — ขึ้นมาเมื่อมีของใหม่ให้กดจริงๆ เท่านั้น
 * และเงียบสนิทเมื่อตรวจสอบไม่สำเร็จ (เน็ตไม่ถึง GitHub) เพราะไม่ใช่เรื่องที่
 * เจ้าหน้าที่หน้างานต้องรับรู้หรือแก้ไขได้
 */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/update");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.supported && data.hasUpdate) setInfo(data);
      } catch {
        // ตรวจไม่ได้ก็ไม่ต้องแสดงอะไร
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runUpdate() {
    if (
      !window.confirm(
        `อัปเดตเป็น ${info?.latest} ตอนนี้เลยไหม\n\n` +
          `โปรแกรมจะปิดและเปิดใหม่เอง ผู้ใช้คนอื่นจะใช้งานไม่ได้ราวหนึ่งนาที\n` +
          `ค่าตั้งค่าทั้งหมดจะไม่หาย`
      )
    ) {
      return;
    }
    setUpdating(true);
    setMessage("กำลังดาวน์โหลดและติดตั้งเวอร์ชันใหม่ กรุณารอสักครู่แล้วรีเฟรชหน้าเว็บ");
    try {
      await fetch("/api/update", { method: "POST" });
    } catch {
      // คำขอขาดกลางคันเป็นเรื่องปกติ เพราะเซิร์ฟเวอร์ถูกปิดระหว่างอัปเดต
    }
  }

  if (!info) return null;

  return (
    <div className="page-card" style={{ marginBottom: 20 }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>มีเวอร์ชันใหม่ให้อัปเดต</h2>
        <span className="status-pill status-pending">{info.latest}</span>
      </div>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        เวอร์ชันที่ใช้อยู่คือ <strong>{info.current || "(ไม่ทราบ)"}</strong> —
        กดอัปเดตแล้วโปรแกรมจะดาวน์โหลดจาก GitHub ปิดตัวเองและเปิดใหม่โดยอัตโนมัติ
        ใช้เวลาราวหนึ่งนาที <strong>ค่าตั้งค่าทั้งหมดไม่หาย</strong>
        ถ้าอัปเดตล้มเหลวระบบจะย้อนกลับเป็นเวอร์ชันเดิมให้เอง ควรทำตอนไม่มีคนใช้งาน
      </p>
      {message ? <p style={{ color: "var(--muted)" }}>{message}</p> : null}
      <div className="toolbar">
        <button className="button-primary" onClick={runUpdate} disabled={updating}>
          {updating ? "กำลังอัปเดต..." : `อัปเดตเป็น ${info.latest}`}
        </button>
      </div>
    </div>
  );
}
