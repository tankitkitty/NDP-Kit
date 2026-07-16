import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { getSession } from "../../lib/session";
import { getHospitalName } from "../../lib/db";
import Layout from "../../components/Layout";

type EclaimRow = Record<string, any>;

const TEXT_FIELDS: { key: string; label: string }[] = [
  { key: "vn", label: "VN" },
  { key: "hn", label: "HN" },
  { key: "claim_staff", label: "ผู้บันทึก (claim_staff)" },
  { key: "nhso_id", label: "NHSO ID" },
  { key: "nhso_seq", label: "NHSO Seq" },
  { key: "nhso_uid", label: "NHSO UID" },
  { key: "nhso_record_status", label: "NHSO Record Status" },
  { key: "nhso_payment_status", label: "NHSO Payment Status" },
  { key: "nhso_budget_no", label: "NHSO Budget No" },
  { key: "nhso_doc_no", label: "NHSO Doc No" },
  { key: "nhso_rep_no", label: "NHSO Rep No" },
  { key: "nhso_period", label: "NHSO Period" },
  { key: "nhso_btch_no", label: "NHSO Batch No" },
  { key: "nhso_source_channel", label: "NHSO Source Channel" },
  { key: "rep_eclaim_detail_rep_no", label: "Rep Eclaim Detail Rep No" },
];

const DATETIME_FIELDS: { key: string; label: string }[] = [
  { key: "eclaim_fee_schedule_req_date", label: "วันที่ส่งเคลม" },
  { key: "nhso_run_date", label: "NHSO Run Date" },
  { key: "nhso_book_date", label: "NHSO Book Date" },
];

const TEXTAREA_FIELDS: { key: string; label: string }[] = [
  { key: "nhso_message", label: "NHSO Message" },
  { key: "rep_eclaim_detail_error_code", label: "Rep Eclaim Detail Error Code" },
  { key: "eclaim_fee_schedule_check_req", label: "Check Request" },
  { key: "eclaim_fee_schedule_req", label: "Request (Raw)" },
  { key: "eclaim_fee_schedule_resp", label: "Response (Raw)" },
];

const STATUS_OPTIONS = [
  { value: "", label: "ยังไม่ส่ง" },
  { value: "Y", label: "สำเร็จ (Y)" },
  { value: "N", label: "ไม่สำเร็จ (N)" },
  { value: "C", label: "ยกเลิก (C)" },
];

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = getSession(context.req);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  return { props: { loginname: session.loginname, hospitalName } };
};

function toDatetimeLocal(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EclaimFeeScheduleEdit({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const router = useRouter();
  const { id } = router.query;

  const [row, setRow] = useState<EclaimRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchRow();
  }, [id]);

  async function fetchRow() {
    setLoading(true);
    try {
      const res = await fetch(`/api/eclaim-fee-schedule/${id}`);
      const data = await res.json();
      if (res.ok) {
        setRow(data.row);
      } else {
        setMessage(data.error || "ไม่สามารถโหลดข้อมูลได้");
      }
    } catch (error) {
      setMessage("ไม่สามารถโหลดข้อมูลได้");
    } finally {
      setLoading(false);
    }
  }

  function updateField(key: string, value: string) {
    setRow((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // กลับไปหน้ารายการโดยคงการค้นหา/ตัวกรองเดิมไว้ (router.back คืน URL เดิมพร้อม query)
  // ถ้าเปิดหน้านี้ตรงๆ (ไม่มีประวัติ) ให้ push กลับหน้ารายการแทน
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/eclaim-fee-schedule");
    }
  }

  async function handleSave() {
    if (!row) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/eclaim-fee-schedule/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const data = await res.json();
      if (res.ok) {
        // บันทึกสำเร็จ → ปิดหน้าต่างแก้ไข กลับไปหน้ารายการที่ค้นหาไว้เดิม
        goBack();
        return;
      } else {
        setMessage(data.error || "ไม่สามารถบันทึกข้อมูลได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการบันทึก");
    } finally {
      setSaving(false);
    }
  }

  const isError = message ? /ไม่สามารถ|ผิดพลาด/.test(message) : false;

  return (
    <Layout title={`แก้ไข eClaim Fee Schedule #${id}`} loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 24 }}>
          <a role="button" tabIndex={0} onClick={goBack} style={{ cursor: "pointer" }}>
            &larr; กลับไปรายการ
          </a>
        </div>
        <div className="brand" style={{ marginBottom: 24 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            แก้ไขข้อมูล eClaim Fee Schedule #{id}
          </h1>
        </div>

        {message ? (
          <div className={`status-message ${isError ? "status-error" : "status-success"}`} style={{ marginBottom: 20 }}>
            {message}
          </div>
        ) : null}

        {loading ? (
          <p>กำลังโหลด...</p>
        ) : !row ? (
          <div className="empty-state">
            <span className="empty-state-icon">⚠️</span>
            <p style={{ margin: 0, fontWeight: 600 }}>ไม่พบข้อมูล</p>
          </div>
        ) : (
          <>
            <section style={{ marginBottom: 32 }}>
              <h2 className="section-title">สถานะ</h2>
              <div className="add-item-card" style={{ maxWidth: 300 }}>
                <div className="label-group">
                  <label>สถานะการส่งเคลม</label>
                  <select
                    className="input-field"
                    value={row.eclaim_fee_schedule_status || ""}
                    onChange={(e) => updateField("eclaim_fee_schedule_status", e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 className="section-title">ข้อมูลทั่วไป</h2>
              <div className="add-item-card">
                <div className="form-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  {TEXT_FIELDS.map((field) => (
                    <div className="label-group" key={field.key}>
                      <label>{field.label}</label>
                      <input
                        className="input-field"
                        value={row[field.key] ?? ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                      />
                    </div>
                  ))}
                  {DATETIME_FIELDS.map((field) => (
                    <div className="label-group" key={field.key}>
                      <label>{field.label}</label>
                      <input
                        className="input-field"
                        type="datetime-local"
                        lang="th"
                        value={toDatetimeLocal(row[field.key])}
                        onChange={(e) => updateField(field.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 className="section-title">รายละเอียด Request / Response</h2>
              <div className="add-item-card">
                <div className="grid-form">
                  {TEXTAREA_FIELDS.map((field) => (
                    <div className="label-group" key={field.key}>
                      <label>{field.label}</label>
                      <textarea
                        className="textarea-field"
                        style={{ minHeight: 100, fontFamily: "monospace", fontSize: "0.85rem" }}
                        value={row[field.key] ?? ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="toolbar">
              <button className="button-primary" onClick={handleSave} disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
              </button>
              <button className="button-ghost" onClick={goBack} disabled={saving}>
                ยกเลิก
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
