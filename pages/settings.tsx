import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { getHospitalName } from "../lib/db";
import Logo from "../components/Logo";

type Config = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  hasPassword?: boolean;
};

export const getServerSideProps: GetServerSideProps = async () => {
  const hospitalName = await getHospitalName();
  return { props: { hospitalName } };
};

function validateConfig(config: Config): string | null {
  if (!config.host.trim()) return "กรุณาระบุ Host";
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) return "Port ไม่ถูกต้อง";
  if (!config.user.trim()) return "กรุณาระบุ User";
  if (!config.database.trim()) return "กรุณาระบุ Database";
  return null;
}

export default function Settings({ hospitalName }: { hospitalName: string }) {
  const [config, setConfig] = useState<Config>({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "",
    database: "nextjs_app",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (res.ok && data.config) {
        setConfig(data.config);
      } else if (!res.ok) {
        setMessage(data.error || "ไม่สามารถโหลดการตั้งค่าได้");
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function saveConfig() {
    const validationError = validateConfig(config);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "บันทึกสำเร็จ");
      } else {
        setMessage(data.error || "ไม่สามารถบันทึกการตั้งค่าได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการบันทึก");
    } finally {
      setSavingConfig(false);
    }
  }

  async function testConnection() {
    const validationError = validateConfig(config);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setTestingConnection(true);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "เชื่อมต่อฐานข้อมูลสำเร็จ");
      } else {
        setMessage(data.error || "ไม่สามารถเชื่อมต่อฐานข้อมูลได้");
      }
    } catch (error) {
      setMessage("เกิดข้อผิดพลาดในการทดสอบเชื่อมต่อ");
    } finally {
      setTestingConnection(false);
    }
  }

  return (
    <div className="container">
      <Head>
        <title>ตั้งค่าการเชื่อมต่อ - 13File Tools</title>
      </Head>
      <div className="page-card">
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 24 }}>
          <Link href="/">&larr; กลับหน้าหลัก</Link>
          <div className="toolbar">
            {hospitalName ? (
              <span className="user-pill">
                <span aria-hidden="true">🏥</span>
                {hospitalName}
              </span>
            ) : null}
            <Link href="/login" className="button-primary">
              Login
            </Link>
          </div>
        </div>
        <div className="brand" style={{ marginBottom: 16 }}>
          <Logo size={44} />
          <h1 className="page-title" style={{ marginBottom: 0, fontSize: "2rem" }}>ตั้งค่าการเชื่อมต่อ</h1>
        </div>

        <section>
          <h2 className="section-title">ตั้งค่าฐานข้อมูล</h2>
          <div className="add-item-card" style={{ maxWidth: 560 }}>
            <div className="grid-form">
              <div className="form-row">
                <div className="label-group">
                  <label>Host</label>
                  <input
                    className="input-field"
                    value={config.host}
                    onChange={(e) => setConfig({ ...config, host: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>Port</label>
                  <input
                    className="input-field"
                    type="number"
                    value={config.port}
                    onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="label-group">
                  <label>User</label>
                  <input
                    className="input-field"
                    value={config.user}
                    onChange={(e) => setConfig({ ...config, user: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>Password</label>
                  <input
                    className="input-field"
                    type="password"
                    value={config.password}
                    placeholder={config.hasPassword ? "•••••••• (เว้นว่างเพื่อคงรหัสผ่านเดิม)" : ""}
                    onChange={(e) => setConfig({ ...config, password: e.target.value })}
                  />
                </div>
              </div>
              <div className="label-group">
                <label>Database</label>
                <input
                  className="input-field"
                  value={config.database}
                  onChange={(e) => setConfig({ ...config, database: e.target.value })}
                />
              </div>
              <div className="toolbar" style={{ marginTop: 4 }}>
                <button className="button-primary" onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? "กำลังบันทึก..." : "Save Config"}
                </button>
                <button className="button-primary" onClick={testConnection} disabled={testingConnection}>
                  {testingConnection ? "กำลังทดสอบ..." : "Test Connection"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {message ? <div className="status-message">{message}</div> : null}
      </div>
    </div>
  );
}
