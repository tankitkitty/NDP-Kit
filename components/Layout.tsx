import { ReactNode, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Logo from "./Logo";

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "หน้าแรก" },
  { href: "/import-43file", label: "นำเข้า 43 แฟ้ม" },
  { href: "/eclaim-fee-schedule", label: "eClaim Fee Schedule" },
  { href: "/eligibility-check", label: "ตรวจสอบสิทธิ" },
  { href: "/settings", label: "ตั้งค่าการเชื่อมต่อ" },
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
        <title>{title ? `${title} - 13File Tools` : "13File Tools"}</title>
      </Head>

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Logo size={40} />
          <span className="sidebar-brand-name">13File Tools</span>
        </div>
        {loginname ? (
          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="sidebar-footer">
          {hospitalName ? <span className="user-pill">{hospitalName}</span> : null}
          {loginname ? (
            <>
              <span className="user-pill">
                <span className="user-avatar">{loginname.charAt(0).toUpperCase()}</span>
                {loginname}
              </span>
              <button className="button-ghost" onClick={handleLogout}>
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
          <span className="topbar-title">13File Tools</span>
        </div>
        <div className="app-content" style={fullWidth ? { maxWidth: "none" } : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
