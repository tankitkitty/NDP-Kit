import Link from "next/link";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import Layout from "../components/Layout";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

export default function Home({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  return (
    <Layout loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 24 }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>13File Tools</h1>
            <p className="brand-subtitle">จัดการรายการข้อมูลของคุณได้ในที่เดียว</p>
          </div>
        </div>
        <div className="toolbar">
          <Link href="/import-43file" className="button-primary">
            นำเข้า 43 แฟ้ม
          </Link>
          <Link href="/eclaim-fee-schedule" className="button-primary">
            ตรวจสอบ eClaim Fee Schedule
          </Link>
        </div>
      </div>
    </Layout>
  );
}
