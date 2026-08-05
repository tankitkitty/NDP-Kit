import { useEffect, useMemo, useState } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
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

const STORE_KEY = "ndp-setup-checklist-v1";

type Step = {
  key: string;
  title: string;
  detail: string;
  /** ลิงก์ไปเครื่องมือที่ช่วยทำขั้นตอนนี้ (ถ้ามี) */
  link?: { href: string; label: string };
};

// ลำดับขั้นตอนตามคู่มือเตรียมส่งเคลม 13 แฟ้มเข้า NDP — เรียงจากตั้งค่าพื้นฐานไปจนถึงส่งเคลม
//
// เลขข้อในหน้าตรวจก่อนส่งเคลมนับใหม่จาก 1 ในแต่ละแท็บ การอ้างถึงจึงต้องบอกชื่อแท็บด้วย
// ไม่งั้นเลขซ้ำกันข้ามแท็บจนหาไม่เจอ และลิงก์ส่ง ?tab= ไปเพื่อให้เปิดมาตรงแท็บนั้นเลย
const STEPS: Step[] = [
  {
    key: "deformed",
    title: "ตั้งค่าเลขบัตรผู้พิการให้ตรงเลขบัตรประชาชน",
    detail:
      "ตรวจ person_deformed.deformed_no ให้เท่ากับ person.cid (ไม่มีขีด) ทุกราย — ใช้การ์ดข้อ 1 แท็บข้อมูลตั้งต้นและการตั้งค่า ในหน้าตรวจก่อนส่งเคลม แก้อัตโนมัติได้",
    link: { href: "/ndp-precheck?tab=master", label: "ไปหน้าตรวจ (ข้อมูลตั้งต้น ข้อ 1)" },
  },
  {
    key: "pocode",
    title: "ตรวจรหัสไปรษณีย์ผู้ป่วยให้ครบ 5 หลัก",
    detail: "แก้ patient.po_code ที่ไม่ใช่ตัวเลข 5 หลักในหน้าเวชระเบียน — ดูรายชื่อจากการ์ดข้อ 2 แท็บข้อมูลตั้งต้นและการตั้งค่า",
    link: { href: "/ndp-precheck?tab=master", label: "ไปหน้าตรวจ (ข้อมูลตั้งต้น ข้อ 2)" },
  },
  {
    key: "provider",
    title: "กรอกข้อมูลบุคลากรทางการแพทย์ให้ครบ",
    detail:
      "เลขใบประกอบวิชาชีพ, เลขบัตรประชาชน 13 หลัก, ประเภทบุคลากร (provider_type) และรหัสสภาวิชาชีพ (01-07) ของเจ้าหน้าที่ทุกคนที่ยังปฏิบัติงาน รวมทั้งเทียบตาราง doctor_position กับ doctor_position_std ให้ลำดับตรงกัน",
    link: { href: "/ndp-precheck?tab=master", label: "ไปหน้าตรวจ (ข้อมูลตั้งต้น ข้อ 3)" },
  },
  {
    key: "pttype",
    title: "ตั้งค่าสิทธิการรักษา (pttype) สำหรับส่งเบิก",
    detail:
      "สิทธิที่เบิกได้ต้องตั้ง noexpire='Y', export_eclaim='Y', is_pttype_plan='Y', default_request_funds='Y', paidst='02' และ pttype_price_group_id (1=เบิกได้ OFC/LGO, 2=UC/WEL)",
    link: { href: "/ndp-precheck?tab=master", label: "ไปหน้าตรวจ (ข้อมูลตั้งต้น ข้อ 4)" },
  },
  {
    key: "token",
    title: "ตั้งค่า Token สำหรับส่งแฟ้ม",
    detail:
      "ตั้งค่า token ในหน้าจอส่งออกของ HOSxP (เก็บใน sys_var) และให้เจ้าหน้าที่ล็อกอิน NHSO ใน HOSxP เพื่อให้มี token ที่ไม่หมดอายุ",
    link: { href: "/ndp-precheck?tab=master", label: "ไปหน้าตรวจ (ข้อมูลตั้งต้น ข้อ 5)" },
  },
  {
    key: "drug",
    title: "นำเข้า Drug Catalog และปรับรหัส/ราคายา",
    detail:
      "นำเข้า Drug Catalog รอบล่าสุด แล้วปรับ drugitems.sks_drug_code และ unitprice ให้ตรงรายการล่าสุด (ตาม dateeffective) พร้อมตั้งหมวดรายได้ (income) ของยาทุกตัว",
    link: { href: "/ndp-precheck?tab=codes", label: "ไปหน้าตรวจ (รหัสบริการและราคา ข้อ 1)" },
  },
  {
    key: "price",
    title: "ตรวจราคาที่คีย์จริงเทียบราคาตั้งต้น",
    detail: "เลือกช่วงวันที่ที่จะส่งเคลม แล้วตรวจว่า opitemrece.unitprice ตรงกับ drugitems.unitprice",
    link: { href: "/ndp-precheck?tab=codes", label: "ไปหน้าตรวจ (รหัสบริการและราคา ข้อ 2)" },
  },
  {
    key: "services",
    title: "ตั้งรหัสบริการคัดกรองตามที่ NDP กำหนด",
    detail:
      "HPV, คัดกรองเบาหวาน, Cholesterol+HDL, CBC 13-24 ปี, เคลือบฟลูออไรด์, Fit Test, ไวรัสตับอักเสบ, วัคซีนไข้หวัดใหญ่ (Z251) และวัคซีนอื่นๆ, ยาคุมกำเนิด, ถุงยางอนามัย — ติ๊ก checklist ในการ์ดข้อ 3 แท็บรหัสบริการและราคา",
    link: { href: "/ndp-precheck?tab=codes", label: "ไปหน้าตรวจ (รหัสบริการและราคา ข้อ 3)" },
  },
  {
    key: "auth",
    title: "ตรวจสอบสิทธิ/ปิดสิทธิให้ได้เลข Authorization ทุกเคส",
    detail: "เคสที่จะส่งเคลมต้องมีเลขปิดสิทธิใน visit_pttype.auth_code — ใช้หน้าตรวจสอบสิทธิปิดย้อนหลังได้",
    link: { href: "/eligibility-check", label: "ไปหน้าตรวจสอบสิทธิ" },
  },
  {
    key: "invoice",
    title: "ออกใบแจ้งหนี้ให้ครบทุกเคส",
    detail: "ออกใบแจ้งหนี้ในระบบการเงินของ HOSxP ให้เคสที่จะส่งเคลมครบถ้วน ก่อนออกชุดข้อมูลส่ง",
  },
  {
    key: "send",
    title: "ส่งเคลม 13 แฟ้มเข้า NDP และติดตามสถานะ",
    detail:
      "ส่งออก 13 แฟ้มจาก HOSxP แล้วติดตามผลจากหน้าเว็บ NDP ของ สปสช. — ถ้าถูกตีกลับ ให้กลับมาไล่ตามการ์ดตรวจสอบอีกครั้ง",
    link: { href: "/ndp-precheck?tab=service", label: "ดูประวัติการส่ง (ตรวจข้อมูลการบริการ ข้อ 5)" },
  },
];

export default function SetupChecklist({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* ค่าเสีย เริ่มใหม่ */
    }
    setLoaded(true);
  }, []);

  function toggle(key: string) {
    setDone((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function resetAll() {
    if (!window.confirm("ล้างสถานะ checklist ทั้งหมด (ในเครื่องนี้) ใช่หรือไม่?")) return;
    setDone({});
    localStorage.removeItem(STORE_KEY);
  }

  const doneCount = useMemo(() => STEPS.filter((s) => done[s.key]).length, [done]);
  const percent = Math.round((doneCount / STEPS.length) * 100);

  return (
    <Layout title="Checklist ตั้งค่าเริ่มต้น" loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Checklist ตั้งค่าเริ่มต้นก่อนส่งเคลม NDP</h1>
        </div>
        <p className="brand-subtitle" style={{ marginBottom: 20 }}>
          ทำตามลำดับทีละขั้น เหมาะสำหรับเจ้าหน้าที่ที่เพิ่งเริ่มตั้งระบบ — สถานะที่ติ๊กเก็บไว้ในเบราว์เซอร์เครื่องนี้ (localStorage) ไม่เขียนลงฐานข้อมูล
        </p>

        <div className="toolbar" style={{ marginBottom: 8, alignItems: "center" }}>
          <div className="progress-track" style={{ flex: 1, minWidth: 200 }}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
            {doneCount}/{STEPS.length} ขั้นตอน ({percent}%)
          </span>
          <button className="button-ghost precheck-small-btn" onClick={resetAll}>
            เริ่มใหม่
          </button>
        </div>

        <div className="precheck-list" style={{ marginTop: 16 }}>
          {STEPS.map((step, idx) => (
            <div key={step.key} className={`precheck-card step-card ${loaded && done[step.key] ? "step-done" : ""}`}>
              <label className="precheck-check-item" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={Boolean(done[step.key])} onChange={() => toggle(step.key)} />
                <span style={{ minWidth: 0 }}>
                  <span className="precheck-card-title">
                    ขั้นที่ {idx + 1}: {step.title}
                  </span>
                  <span style={{ display: "block", color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}>{step.detail}</span>
                  {step.link ? (
                    <Link href={step.link.href} className="step-link">
                      {step.link.label} →
                    </Link>
                  ) : null}
                </span>
              </label>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
