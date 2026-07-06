import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import Logo from "../components/Logo";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

export default function Home({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="container" style={{ maxWidth: "100%", width: "100%" }}>
      <Head>
        <title>13File Tools</title>
      </Head>
      <div className="page-card">
        <div className="toolbar" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
          {hospitalName ? (
            <span className="user-pill">
              <span aria-hidden="true">🏥</span>
              {hospitalName}
            </span>
          ) : null}
          <span className="user-pill">
            <span className="user-avatar">{loginname.charAt(0).toUpperCase()}</span>
            {loginname}
          </span>
          <button className="button-ghost" onClick={handleLogout}>
            ออกจากระบบ
          </button>
        </div>
        <div className="brand" style={{ marginBottom: 24 }}>
          <Logo size={44} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 0, fontSize: "2rem" }}>13File Tools</h1>
            <p className="brand-subtitle">จัดการรายการข้อมูลของคุณได้ในที่เดียว</p>
          </div>
        </div>
        <div className="toolbar">
          <Link href="/eclaim-fee-schedule" className="button-primary">
            ตรวจสอบ eClaim Fee Schedule
          </Link>
        </div>
      </div>
    </div>
  );
}
