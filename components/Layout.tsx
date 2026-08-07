import type { JSX } from "react";
import { ReactNode, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import BrandLogo from "./BrandLogo";
import VersionCheck from "./VersionCheck";
import {
  DatabaseIcon,
  FeeScheduleIcon,
  HomeIcon,
  IconProps,
  LogoutIcon,
  PrecheckIcon,
  ReportIcon,
} from "./NavIcons";

/**
 * เลขเวอร์ชันถูกฝังตอน build โดย scripts/release.ps1
 *
 * ใช้วิธีนี้แทนการอ่านไฟล์ version.txt ตอนรัน เพราะ Layout อยู่ฝั่งเบราว์เซอร์
 * ถ้าจะอ่านไฟล์ต้องส่ง prop ผ่านทุกหน้า หรือยิง API เพิ่มทุกครั้งที่เปลี่ยนหน้า
 * ส่วนตอนรันจากซอร์สโค้ดของนักพัฒนาจะไม่มีค่า จึงไม่แสดงอะไร
 */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "";

interface NavItem {
  href: string;
  label: string;
  // React 19 เลิกประกาศ JSX เป็น global namespace แล้ว ต้อง import type มาใช้เอง
  Icon: (props: IconProps) => JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "หน้าแรก", Icon: HomeIcon },
  // ปิดเมนูนำเข้า 43 แฟ้มไว้ก่อน ตัวหน้าและ API ยังอยู่ครบ เข้าถึงได้ทาง URL ตรงๆ
  // ถ้าจะเปิดใช้อีกครั้ง เอาบรรทัดล่างนี้กลับมา (ImportIcon มีอยู่แล้วใน NavIcons)
  // { href: "/import-43file", label: "นำเข้า 43 แฟ้ม", Icon: ImportIcon },
  { href: "/eclaim-fee-schedule", label: "eClaim Fee Schedule", Icon: FeeScheduleIcon },
  // ปิดเมนูตรวจสอบสิทธิไว้ก่อน ตัวหน้าและ API ยังอยู่ครบ เข้าถึงได้ทาง URL ตรงๆ
  // ถ้าจะเปิดใช้อีกครั้ง เอาบรรทัดล่างนี้กลับมา (EligibilityIcon มีอยู่แล้วใน NavIcons)
  // { href: "/eligibility-check", label: "ตรวจสอบสิทธิ", Icon: EligibilityIcon },
  { href: "/ndp-precheck", label: "ตรวจก่อนส่งเคลม NDP", Icon: PrecheckIcon },
  { href: "/reports", label: "รายงานที่เขียนเอง", Icon: ReportIcon },
  // ปิดเมนู Checklist ตั้งค่าไว้ก่อน ตัวหน้ายังอยู่ครบ เข้าถึงได้ทาง URL ตรงๆ
  // ถ้าจะเปิดใช้อีกครั้ง เอาบรรทัดล่างนี้กลับมา (ChecklistIcon มีอยู่แล้วใน NavIcons)
  // และเอาปุ่มบนหน้าแรกใน pages/index.tsx กลับมาด้วย
  // { href: "/setup-checklist", label: "Checklist ตั้งค่า", Icon: ChecklistIcon },
  { href: "/settings", label: "ตั้งค่าการเชื่อมต่อ", Icon: DatabaseIcon },
];

interface LayoutProps {
  title?: string;
  loginname?: string;
  hospitalName?: string;
  /** ปลดล็อกความกว้างเนื้อหา (ปกติ 1160px) สำหรับหน้าที่มีตารางคอลัมน์เยอะ */
  fullWidth?: boolean;
  children: ReactNode;
}

export default function Layout({ title, loginname, hospitalName, fullWidth, children }: LayoutProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [router.pathname]);

  /**
   * หมดเวลาใช้งาน 8 ชั่วโมงแล้วให้พากลับไปหน้าเข้าสู่ระบบเอง
   *
   * ตัว session หมดอายุถูกต้องอยู่แล้วฝั่งเซิร์ฟเวอร์ (ดู lib/session.ts) และการ
   * เปลี่ยนหน้าจะถูกพากลับไป /login ให้เอง แต่ถ้าผู้ใช้เปิดค้างหน้าเดิมไว้แล้วกดปุ่ม
   * ในหน้านั้น API จะตอบ 401 ซึ่งแต่ละหน้าเอาไปแสดงเป็นข้อความสีแดงว่า
   * "กรุณาเข้าสู่ระบบ" ค้างอยู่ตรงนั้น ผู้ใช้อ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ
   * และไม่รู้ว่างานที่เพิ่งกดไปสำเร็จหรือไม่
   *
   * ดักที่ fetch ตรงกลางทีเดียว เพราะถ้าไปไล่แก้ทุกหน้าที่เรียก API จะตกหล่นแน่นอน
   * และหน้าใหม่ที่เขียนทีหลังก็จะลืมใส่อีก
   */
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 401) {
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        // หน้า login ไม่ได้ใช้ Layout อยู่แล้ว แต่กันไว้เผื่อ 401 จาก /api/login เอง
        if (url.includes("/api/") && !url.includes("/api/login")) {
          void router.replace("/login?expired=1");
        }
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [router]);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string): boolean {
    if (href === "/") return router.pathname === "/";
    return router.pathname.startsWith(href);
  }

  return (
    <div className="app-shell">
      <Head>
        <title>{title ? `${title} - NDP-Kit` : "NDP-Kit"}</title>
      </Head>

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        {/* ใช้โลโก้แบบพื้นเข้มซึ่งมีแผ่นน้ำเงินมาในไฟล์อยู่แล้ว วางบนแถบเมนูได้ตรงๆ
            ชื่อโปรแกรมอยู่ในรูปแล้วจึงไม่เขียนซ้ำ */}
        <div className="sidebar-brand">
          <BrandLogo variant="dark" width={200} />
          {APP_VERSION ? <span className="sidebar-brand-version">Version {APP_VERSION}</span> : null}
        </div>
        {loginname ? (
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className={isActive(href) ? "active" : ""}>
                <Icon />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="sidebar-footer">
          {loginname ? <VersionCheck /> : null}
          {hospitalName ? <span className="user-pill">{hospitalName}</span> : null}
          {loginname ? (
            <>
              <span className="user-pill">
                <span className="user-avatar">{loginname.charAt(0).toUpperCase()}</span>
                {loginname}
              </span>
              <button className="button-ghost" onClick={handleLogout}>
                <LogoutIcon size={16} />
                ออกจากระบบ
              </button>
            </>
          ) : (
            <Link href="/login" className="button-ghost">
              เข้าสู่ระบบ
            </Link>
          )}
        </div>
      </aside>

      {mobileOpen ? <div className="sidebar-backdrop open" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <div className="topbar">
          <button className="hamburger-btn" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู">
            ☰
          </button>
          <span className="topbar-title">NDP-Kit</span>
        </div>
        <div className="app-content" style={fullWidth ? { maxWidth: "none" } : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
