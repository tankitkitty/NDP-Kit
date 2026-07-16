import { useRef } from "react";

// ค่าเก็บภายในเป็น YYYY-MM-DD (ใช้กับ API/ฐานข้อมูล) แต่แสดงผลเป็น วว/ดด/ปปปป เสมอ
// เพราะ native <input type="date"> บังคับรูปแบบการแสดงผลตาม locale ของเบราว์เซอร์ไม่ได้
function toDMY(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
}

export default function DateField({ value, onChange, min, max, className }: Props) {
  const nativeRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = nativeRef.current;
    if (!el) return;
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") {
      try {
        anyEl.showPicker();
        return;
      } catch {
        /* บางเบราว์เซอร์เรียกไม่ได้ ให้ตกไปที่ focus/click แทน */
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="date-field" onClick={openPicker}>
      <input type="text" readOnly className={className || "input-field"} value={toDMY(value)} placeholder="วว/ดด/ปปปป" />
      <span className="date-field-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
        </svg>
      </span>
      <input
        ref={nativeRef}
        className="date-field-native"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
