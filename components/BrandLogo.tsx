import { useState } from "react";
import Logo from "./Logo";

/**
 * โลโก้ของโปรแกรม มีสามแบบให้เลือกตามพื้นหลังที่จะเอาไปวาง
 *
 *   light — โลโก้เต็ม (ไอคอน + ชื่อ + NHSO Digital Platform) สำหรับพื้นสีอ่อน
 *   dark  — โลโก้เต็มบนแผ่นน้ำเงินเข้ม สำหรับพื้นสีเข้ม เช่นแถบเมนูซ้าย
 *   mark  — เฉพาะไอคอนสี่เหลี่ยมมน ใช้ในที่แคบๆ ที่ตัวหนังสือจะเล็กจนอ่านไม่ออก
 *
 * ไฟล์โลโก้เป็นแนวนอน (กว้างประมาณ 2.4 เท่าของสูง) ยกเว้น mark ที่เป็นจัตุรัส
 * ค่า width จึงเป็นตัวกำหนดขนาด ส่วนความสูงปล่อยให้คำนวณตามสัดส่วนเอง
 *
 * ถ้าไฟล์หายหรือโหลดไม่ได้ จะสลับไปใช้โลโก้ SVG ในโค้ดแทน พร้อมเติมชื่อโปรแกรม
 * ให้ในแบบ light/dark เพราะตัวสำรองมีแต่รูปไม่มีตัวหนังสือ — หน้าเว็บจะได้ไม่เหลือ
 * แค่รูปแตกถ้าวันหนึ่งไฟล์หาย
 *
 * ไม่ใช้ next/image เพราะต้องการ fallback ตอนโหลดไม่สำเร็จ ซึ่ง <img> ธรรมดา
 * จัดการตรงไปตรงมากว่า และไฟล์อยู่ในเครื่องอยู่แล้วไม่ต้อง optimize
 */
export type LogoVariant = "light" | "dark" | "mark";

const SOURCES: Record<LogoVariant, string> = {
  light: "/NDP-Kit-logo.png",
  dark: "/NDP-Kit-logo-dark.png",
  mark: "/NDP-Kit-mark.png",
};

export default function BrandLogo({
  variant = "light",
  width = 280,
}: {
  variant?: LogoVariant;
  width?: number;
}) {
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback) {
    // ตัวสำรองเป็นจัตุรัส จึงย่อให้พอดีกับพื้นที่แนวนอนที่เผื่อไว้
    const size = variant === "mark" ? width : Math.round(width * 0.36);
    return (
      <>
        <Logo size={size} />
        {variant === "mark" ? null : (
          <span className={`brand-fallback-name ${variant === "dark" ? "on-dark" : ""}`}>NDP-Kit</span>
        )}
      </>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SOURCES[variant]}
      alt="NDP-Kit — NHSO Digital Platform"
      width={width}
      style={{ width, height: "auto", display: "block" }}
      onError={() => setUseFallback(true)}
    />
  );
}
