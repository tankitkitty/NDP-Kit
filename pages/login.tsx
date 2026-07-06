import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import Logo from "../components/Logo";

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
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!loginname.trim() || !password) {
      setMessage("กรุณาระบุ Username และ Password");
      return;
    }

    setSubmitting(true);
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
    <div className="container">
      <Head>
        <title>เข้าสู่ระบบ - 13File Tools</title>
      </Head>
      <div className="page-card" style={{ maxWidth: 420, margin: "80px auto" }}>
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          {hospitalName ? (
            <span className="user-pill">
              <span aria-hidden="true">🏥</span>
              {hospitalName}
            </span>
          ) : (
            <span />
          )}
          <Link href="/settings" className="button-ghost">
            ตั้งค่าการเชื่อมต่อ
          </Link>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <Logo size={56} />
          <div style={{ textAlign: "center" }}>
            <h1 className="page-title" style={{ fontSize: "1.8rem", marginBottom: 4 }}>13File Tools</h1>
            <p className="brand-subtitle" style={{ margin: 0 }}>เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
          </div>
        </div>
        <form className="grid-form" onSubmit={handleSubmit} style={{ marginTop: 28 }}>
          <div className="label-group">
            <label>Username</label>
            <input
              className="input-field"
              value={loginname}
              onChange={(e) => setLoginname(e.target.value)}
              autoFocus
            />
          </div>
          <div className="label-group">
            <label>Password</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="button-primary" type="submit" disabled={submitting}>
            {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
        {message ? <div className="status-message">{message}</div> : null}
      </div>
    </div>
  );
}
