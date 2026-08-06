import Link from "next/link";
import { GetServerSideProps } from "next";
import { getSession } from "../lib/session";
import { getHospitalName } from "../lib/db";
import Layout from "../components/Layout";
import UpdateBanner from "../components/UpdateBanner";
import ConsentDialog from "../components/ConsentDialog";
import BrandLogo from "../components/BrandLogo";

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
      <ConsentDialog />
      <UpdateBanner />
      <div className="page-card">
        {/* โลโก้มีชื่อโปรแกรมกับคำอธิบายอยู่ในรูปแล้ว จึงไม่เขียนชื่อซ้ำอีก
            เหลือแค่บอกว่าเปิดหน้านี้แล้วทำอะไรต่อได้บ้าง */}
        <div className="home-hero">
          <BrandLogo variant="light" width={300} />
          <p className="home-hero-text">
            เลือกงานที่ต้องการจากปุ่มด้านล่าง หรือจากเมนูด้านซ้าย
          </p>
        </div>
        <div className="toolbar">
          {/* ปิดปุ่มนำเข้า 43 แฟ้มไว้ให้ตรงกับแถบเมนูซ้ายที่ปิดไปแล้ว ตัวหน้ายังอยู่ครบ
              เข้าถึงได้ทาง URL ตรงๆ — ถ้าจะเปิดใช้อีกครั้ง เอาบรรทัดล่างนี้กลับมา
          <Link href="/import-43file" className="button-primary">
            นำเข้า 43 แฟ้ม
          </Link>
          */}
          <Link href="/eclaim-fee-schedule" className="button-primary">
            ตรวจสอบ eClaim Fee Schedule
          </Link>
          <Link href="/ndp-precheck" className="button-primary">
            ตรวจก่อนส่งเคลม NDP
          </Link>
          <Link href="/setup-checklist" className="button-primary">
            Checklist ตั้งค่าเริ่มต้น
          </Link>
        </div>
      </div>
    </Layout>
  );
}
