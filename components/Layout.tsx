import type { JSX } from "react";
import { ReactNode, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Logo from "./Logo";
import VersionCheck from "./VersionCheck";
import {
  ChecklistIcon,
  DatabaseIcon,
  FeeScheduleIcon,
  HomeIcon,
  IconProps,
  LogoutIcon,
  PrecheckIcon,
} from "./NavIcons";

/**
 * เลขเวอร์ชันถูกฝังตอน build โดย .github/workflows/release.yml (ค่าจาก git tag)
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
  { href: "/setup-checklist", label: "Checklist ตั้งค่า", Icon: ChecklistIcon },
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
        <title>{title ? `${title} - NDP Kit` : "NDP Kit"}</title>
      </Head>

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Logo size={40} />
          <span className="sidebar-brand-name">NDP Kit</span>
          {APP_VERSION ? <span className="sidebar-brand-version">{APP_VERSION}</span> : null}
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
          <span className="topbar-title">NDP Kit</span>
        </div>
        <div className="app-content" style={fullWidth ? { maxWidth: "none" } : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
