import { useState } from "react";
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

interface Import43Result {
  file: string;
  table: string;
  rowsParsed: number;
  rowsImported: number;
  malformedRows: number;
  errors: string[];
}

export default function Import43File({ loginname, hospitalName }: { loginname: string; hospitalName: string }) {
  const [creatingTables43, setCreatingTables43] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading43, setUploading43] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    results: Import43Result[];
    skippedFiles: string[];
  } | null>(null);

  async function createTables43() {
    setCreatingTables43(true);
    setMessage(null);
    try {
      const res = await fetch("/api/init-43file", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "สร้างตารางสำเร็จ");
      } else {
        setMessage(data.error || "ไม่สามารถสร้างตารางได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการสร้างตาราง");
    } finally {
      setCreatingTables43(false);
    }
  }

  async function uploadZip43() {
    if (!zipFile) {
      setMessage("กรุณาเลือกไฟล์ ZIP ก่อน");
      return;
    }

    setUploading43(true);
    setMessage(null);
    setImportSummary(null);
    try {
      const res = await fetch("/api/import-43file", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: zipFile,
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "นำเข้าข้อมูลสำเร็จ");
        setImportSummary({ results: data.results || [], skippedFiles: data.skippedFiles || [] });
      } else {
        setMessage(data.error || "ไม่สามารถนำเข้าข้อมูลได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการอัพโหลดไฟล์");
    } finally {
      setUploading43(false);
    }
  }

  return (
    <Layout title="นำเข้า 43 แฟ้ม" loginname={loginname} hospitalName={hospitalName}>
      <div className="page-card">
        <div className="section-header" style={{ marginBottom: 24, alignItems: "flex-start" }}>
          <div className="brand">
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>นำเข้า 43 แฟ้ม</h1>
              <p className="brand-subtitle">สร้างตารางและนำเข้าข้อมูลจากไฟล์ ZIP มาตรฐาน 43 แฟ้ม</p>
            </div>
          </div>
          <button className="button-ghost" onClick={createTables43} disabled={creatingTables43}>
            {creatingTables43 ? "กำลังสร้างตาราง..." : "สร้างตาราง (43 แฟ้ม)"}
          </button>
        </div>
        <div className="toolbar">
          <input
            type="file"
            accept=".zip"
            onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
          />
          <button className="button-primary" onClick={uploadZip43} disabled={uploading43 || !zipFile}>
            {uploading43 ? "กำลังนำเข้าข้อมูล..." : "นำเข้าข้อมูล"}
          </button>
        </div>
        {message ? <div className="status-message">{message}</div> : null}
        {importSummary ? (
          <div className="status-message">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {importSummary.results.map((r, i) => (
                <li key={i}>
                  {r.file} → {r.table}: {r.rowsImported.toLocaleString()}/{r.rowsParsed.toLocaleString()} แถว
                  {r.malformedRows > 0 ? ` (ผิดปกติ ${r.malformedRows} แถว)` : ""}
                  {r.errors.length > 0 ? ` — ข้อผิดพลาด: ${r.errors.join(", ")}` : ""}
                </li>
              ))}
              {importSummary.skippedFiles.length > 0 ? (
                <li>ข้ามไฟล์ที่ไม่รู้จัก: {importSummary.skippedFiles.join(", ")}</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
