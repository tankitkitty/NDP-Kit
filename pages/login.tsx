import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import BrandLogo from "../components/BrandLogo";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (session) {
    return { redirect: { destination: "/", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { hospitalName } };
};

export default function Login({ hospitalName }: { hospitalName: string }) {
  const router = useRouter();
  const [loginname, setLoginname] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!loginname.trim() || !password) {
      setMessage("กรุณาระบุ Username และ Password");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginname, password }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/");
      } else {
        setMessage(data.error || "เข้าสู่ระบบไม่สำเร็จ");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการเข้าสู่ระบบ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <Head>
        <title>เข้าสู่ระบบ - NDP-Kit</title>
      </Head>

      <div className="login-card">
        {/* ชื่อโปรแกรมกับคำอธิบายอยู่ในไฟล์โลโก้แล้ว ไม่เขียนซ้ำตรงนี้
            (ถ้าไฟล์โลโก้หาย BrandLogo จะเติมชื่อให้เองจากตัวสำรอง) */}
        <div className="login-brand">
          <BrandLogo variant="light" width={300} />
        </div>

        {hospitalName ? (
          <div className="login-hospital">
            <span aria-hidden="true">🏥</span>
            <span>{hospitalName}</span>
          </div>
        ) : null}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="label-group">
            <label htmlFor="loginname">ชื่อผู้ใช้</label>
            <input
              id="loginname"
              className="input-field"
              value={loginname}
              onChange={(e) => setLoginname(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="label-group">
            <label htmlFor="password">รหัสผ่าน</label>
            {/* ปุ่มดูรหัสผ่านช่วยลดการใส่ผิดซ้ำๆ ซึ่งสำคัญขึ้นมากตั้งแต่มีการระงับ
                การเข้าสู่ระบบ 15 นาทีเมื่อใส่ผิดครบ 10 ครั้ง */}
            <div className="login-password">
              <input
                id="password"
                className="input-field"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
              >
                {showPassword ? "ซ่อน" : "แสดง"}
              </button>
            </div>
          </div>

          <button className="button-primary login-submit" type="submit" disabled={submitting}>
            {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>

        {message ? (
          <div className="status-message status-error login-message">{message}</div>
        ) : router.query.expired !== undefined ? (
          // มาจากการถูกพากลับเพราะใช้งานครบ 8 ชั่วโมง ไม่ใช่ความผิดพลาด จึงไม่ใช้สีแดง
          <div className="status-message login-message">
            ใช้งานครบ 8 ชั่วโมงแล้ว กรุณาเข้าสู่ระบบอีกครั้ง
          </div>
        ) : null}

        <div className="login-footer">
          <Link href="/settings" className="login-link">
            ตั้งค่าการเชื่อมต่อฐานข้อมูล
          </Link>
          {APP_VERSION ? <span className="login-version">{APP_VERSION}</span> : null}
        </div>
      </div>

      <p className="login-note">ใช้ชื่อผู้ใช้และรหัสผ่านเดียวกับที่เข้าโปรแกรม HOSxP</p>
    </div>
  );
}
