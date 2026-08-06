import { useEffect, useState } from "react";

type Preview = {
  hospitalCode: string;
  hospitalName: string;
  machineName: string;
  installedAt: string;
  updatedAt: string;
  version: string;
};

/** วันที่แบบอ่านง่ายสำหรับแสดงในฟอร์ม (ค่าที่ส่งจริงเป็น ISO เต็ม) */
function thaiDate(iso: string): string {
  if (!iso) return "(ไม่ทราบ)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "(ไม่ทราบ)";
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * หน้าต่างแจ้งให้ทราบเรื่องการส่งข้อมูลการใช้งาน แสดงครั้งเดียวตอนตั้งค่าครั้งแรก
 *
 * เป็นการ "แจ้งให้ทราบ" ไม่ใช่ "ขอความยินยอม" จึงมีปุ่มเดียวคือรับทราบ — ทำได้เพราะ
 * ข้อมูลที่ส่งไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคลเลย มีแต่รหัสหน่วยบริการ ชื่อเครื่อง
 * และเวอร์ชันโปรแกรม ถ้อยคำในหน้าต่างนี้ต้องไม่เขียนว่า "ขอความยินยอม" เพราะจะกลาย
 * เป็นถามแล้วไม่ให้ทางปฏิเสธ ซึ่งทำให้ผู้ใช้เข้าใจผิด
 *
 * ทำไมต้องรอจนล็อกอินได้ก่อน: รหัสสถานบริการอ่านจากตาราง opdconfig ในฐานข้อมูล
 * HOSxP ตราบใดที่ยังตั้งค่าฐานข้อมูลไม่สำเร็จก็ยังไม่มีรหัสให้แสดงหรือส่ง และการ
 * ล็อกอินก็ใช้ฐานเดียวกัน จุดนี้จึงเป็นจังหวะแรกสุดที่ถามได้อย่างมีความหมาย
 *
 * วางไว้ที่หน้าหลักเพราะเป็นหน้าแรกที่ทุกคนเห็นหลังล็อกอิน จึงไม่มีทางพลาด
 * ตอบแล้วไม่ว่าจะยินยอมหรือไม่ จะไม่ถามอีกเลย
 */
export default function ConsentDialog() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/register-hospital");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.needConsent) setPreview(data.preview);
      } catch {
        // ถามไม่ได้ก็ข้ามไป ไม่ใช่ส่วนที่จำเป็นต่อการใช้งานโปรแกรม
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function answer(consent: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/register-hospital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent }),
      });
      const data = await res.json();
      if (res.ok) {
        // ฝั่งเซิร์ฟเวอร์บันทึกความยินยอมแล้วและจะส่งข้อมูลให้เองเบื้องหลัง
        // ปิดหน้าต่างได้เลยโดยไม่ต้องรอผลการส่ง
        setPreview(null);
      } else {
        setError(data.error || "บันทึกไม่สำเร็จ");
        setBusy(false);
      }
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      setBusy(false);
    }
  }

  if (!preview) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ textAlign: "left", maxWidth: 520 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          แจ้งการส่งข้อมูลการใช้งาน
        </h2>
        <p style={{ marginTop: 0 }}>
          เพื่อให้ผู้พัฒนาทราบยอดการใช้งานโปรแกรม และแจ้งเตือนได้เมื่อมีเวอร์ชันใหม่
          โปรแกรมจะส่งข้อมูล <strong>เพียง 6 รายการนี้เท่านั้น</strong>
        </p>
        <div className="grid-form" style={{ marginBottom: 16 }}>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>รหัสสถานบริการ</span>
            <strong>{preview.hospitalCode || "(ไม่พบในฐานข้อมูล)"}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>ชื่อสถานพยาบาล</span>
            <strong>{preview.hospitalName || "(ไม่พบในฐานข้อมูล)"}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>ชื่อเครื่องที่ติดตั้ง</span>
            <strong>{preview.machineName || "(ไม่ทราบ)"}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>วันที่ติดตั้ง</span>
            <strong>{thaiDate(preview.installedAt)}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>วันที่อัปเดตล่าสุด</span>
            <strong>{thaiDate(preview.updatedAt)}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>เวอร์ชันโปรแกรม</span>
            <strong>{preview.version || "(ไม่ทราบ)"}</strong>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span>วันเวลาที่ส่ง</span>
            <strong>ขณะที่กดยินยอม</strong>
          </div>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          <strong>ไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคลใดๆ</strong> รวมอยู่ด้วย
          (ชื่อเครื่องคือชื่อในเครือข่ายของหน่วยงาน ไม่ใช่ชื่อผู้ใช้งาน)
          ส่งเฉพาะตอนติดตั้งครั้งแรกและตอนอัปเดตเป็นเวอร์ชันใหม่สำเร็จเท่านั้น
          ไม่ได้ส่งเป็นระยะ และหน้าต่างนี้จะแสดงเพียงครั้งเดียว
        </p>
        {error ? (
          <p style={{ color: "var(--danger, #b42318)", marginTop: 0 }}>{error}</p>
        ) : null}
        <div className="toolbar">
          <button className="button-primary" onClick={() => answer(true)} disabled={busy}>
            {busy ? "กำลังบันทึก..." : "รับทราบ"}
          </button>
        </div>
      </div>
    </div>
  );
}
