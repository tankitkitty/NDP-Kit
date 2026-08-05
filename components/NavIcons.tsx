import { ReactNode } from "react";

/**
 * ไอคอนของเมนูด้านซ้าย เขียนเป็น SVG ในโค้ดเองทั้งหมด
 *
 * ไม่ใช้ไลบรารีไอคอนเพราะแพ็กเกจที่ส่งให้หน่วยบริการต้องรันแบบ standalone และ
 * หลายเครื่องต่ออินเทอร์เน็ตไม่ได้ ไอคอนที่ต้องโหลดจากภายนอกจะกลายเป็นช่องว่าง
 * เปล่าๆ ส่วนการเพิ่ม dependency เข้ามาก็ทำให้ไฟล์ zip ใหญ่ขึ้นโดยไม่จำเป็น
 *
 * ทุกตัวใช้ currentColor จึงเปลี่ยนสีตามสถานะของเมนู (ปกติ/ชี้ค้าง/กำลังเปิดอยู่)
 * ได้เองโดยไม่ต้องมี CSS แยก
 */
function Svg({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type IconProps = { size?: number };

/** หน้าแรก */
export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5" />
    </Svg>
  );
}

/** นำเข้า 43 แฟ้ม — ลูกศรลงถาด สื่อว่าข้อมูลไหลเข้ามาในโปรแกรม */
export function ImportIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v10" />
      <path d="M8 9.5 12 13.5l4-4" />
      <path d="M4 14.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    </Svg>
  );
}

/** eClaim Fee Schedule — เอกสารรายการราคา */
export function FeeScheduleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h5" />
      <path d="M8 12h8" />
      <path d="M8 16h6" />
    </Svg>
  );
}

/** ตรวจสอบสิทธิ — คนพร้อมเครื่องหมายถูก (เมนูปิดอยู่ เก็บไว้ให้เปิดกลับได้ทันที) */
export function EligibilityIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="8.5" cy="8" r="3.5" />
      <path d="M15 11.5 17 13.5 21 9.5" />
    </Svg>
  );
}

/** ตรวจก่อนส่งเคลม NDP — โล่พร้อมเครื่องหมายถูก สื่อว่าตรวจให้ปลอดภัยก่อนส่ง */
export function PrecheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

/** Checklist ตั้งค่า — คลิปบอร์ดติ๊กรายการ */
export function ChecklistIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
      <path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
      <path d="M8.5 13.5 10.5 15.5 14.5 11.5" />
    </Svg>
  );
}

/** ตั้งค่าการเชื่อมต่อ — ทรงกระบอกฐานข้อมูล เพราะหน้านี้คือการตั้งค่าต่อฐานข้อมูล */
export function DatabaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </Svg>
  );
}

/** ออกจากระบบ */
export function LogoutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15.5 16.5 20 12l-4.5-4.5" />
      <path d="M20 12H9.5" />
    </Svg>
  );
}
