import { useEffect, useState } from "react";
import { GetServerSideProps } from "next";
import { getHospitalName } from "../lib/db";
import { getSession } from "../lib/session";
import { isBootstrapPhase } from "../lib/authGuard";
import { getNhsoConfigStatus, NhsoConfigItem } from "../lib/nhso";
import Layout from "../components/Layout";

type Config = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  hasPassword?: boolean;
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  // ช่วงติดตั้งครั้งแรก (ยังไม่มี dbconfig.json) เปิดให้เข้าได้โดยไม่ต้อง login
  // เพื่อตั้งค่า DB — เมื่อตั้งค่าเสร็จแล้วต้องมี session ถึงจะเข้าหน้านี้ได้
  const session = getSession(context.req);
  if (!session && !isBootstrapPhase()) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  const nhsoStatus = getNhsoConfigStatus();
  return { props: { hospitalName, nhsoStatus, loginname: session?.loginname ?? null } };
};

type NhsoStatus = { env: string; items: NhsoConfigItem[]; ready: boolean };

function validateConfig(config: Config): string | null {
  if (!config.host.trim()) return "กรุณาระบุ Host";
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) return "Port ไม่ถูกต้อง";
  if (!config.user.trim()) return "กรุณาระบุ User";
  if (!config.database.trim()) return "กรุณาระบุ Database";
  return null;
}

export default function Settings({
  hospitalName,
  nhsoStatus,
  loginname,
}: {
  hospitalName: string;
  nhsoStatus: NhsoStatus;
  loginname: string | null;
}) {
  const [config, setConfig] = useState<Config>({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "",
    database: "nextjs_app",
  });
  const [config43, setConfig43] = useState<Config>({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "",
    database: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingConfig43, setSavingConfig43] = useState(false);
  const [testingConnection43, setTestingConnection43] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchConfig43();
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

  async function fetchConfig43() {
    try {
      const res = await fetch("/api/config43");
      const data = await res.json();
      if (res.ok && data.config) {
        setConfig43(data.config);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function saveConfig43() {
    const validationError = validateConfig(config43);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setSavingConfig43(true);
    try {
      const res = await fetch("/api/config43", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config43),
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
      setSavingConfig43(false);
    }
  }

  async function testConnection43() {
    const validationError = validateConfig(config43);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setTestingConnection43(true);
    try {
      const res = await fetch("/api/test-connection43", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config43),
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
      setTestingConnection43(false);
    }
  }

  return (
    <Layout title="ตั้งค่าการเชื่อมต่อ" hospitalName={hospitalName} loginname={loginname || undefined}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 16 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>ตั้งค่าการเชื่อมต่อ</h1>
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

        <section style={{ marginTop: 32 }}>
          <h2 className="section-title">ตั้งค่าฐานข้อมูล 43 แฟ้ม</h2>
          <div className="add-item-card" style={{ maxWidth: 560 }}>
            <div className="grid-form">
              <div className="form-row">
                <div className="label-group">
                  <label>Host</label>
                  <input
                    className="input-field"
                    value={config43.host}
                    onChange={(e) => setConfig43({ ...config43, host: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>Port</label>
                  <input
                    className="input-field"
                    type="number"
                    value={config43.port}
                    onChange={(e) => setConfig43({ ...config43, port: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="label-group">
                  <label>User</label>
                  <input
                    className="input-field"
                    value={config43.user}
                    onChange={(e) => setConfig43({ ...config43, user: e.target.value })}
                  />
                </div>
                <div className="label-group">
                  <label>Password</label>
                  <input
                    className="input-field"
                    type="password"
                    value={config43.password}
                    placeholder={config43.hasPassword ? "•••••••• (เว้นว่างเพื่อคงรหัสผ่านเดิม)" : ""}
                    onChange={(e) => setConfig43({ ...config43, password: e.target.value })}
                  />
                </div>
              </div>
              <div className="label-group">
                <label>Database</label>
                <input
                  className="input-field"
                  value={config43.database}
                  onChange={(e) => setConfig43({ ...config43, database: e.target.value })}
                />
              </div>
              <div className="toolbar" style={{ marginTop: 4 }}>
                <button className="button-primary" onClick={saveConfig43} disabled={savingConfig43}>
                  {savingConfig43 ? "กำลังบันทึก..." : "Save Config"}
                </button>
                <button className="button-primary" onClick={testConnection43} disabled={testingConnection43}>
                  {testingConnection43 ? "กำลังทดสอบ..." : "Test Connection"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <div className="section-header">
            <h2 className="section-title" style={{ margin: 0 }}>
              การเชื่อมต่อ NHSO Digital Platform API
            </h2>
            <span className={`status-pill ${nhsoStatus.ready ? "status-y" : "status-n"}`}>
              {nhsoStatus.ready ? "ตั้งค่าครบแล้ว" : "ตั้งค่ายังไม่ครบ"}
            </span>
          </div>
          <div className="add-item-card" style={{ maxWidth: 560 }}>
            <p style={{ marginTop: 0, color: "var(--muted)" }}>
              โหมด: <strong>{nhsoStatus.env}</strong> — ตั้งค่าผ่านไฟล์ <code>.env.local</code> เท่านั้น
              (ไม่สามารถกรอก/บันทึกผ่านหน้านี้ได้ เพื่อป้องกันข้อมูลลับหลุด)
            </p>
            <div className="grid-form">
              {nhsoStatus.items.map((item) => (
                <div key={item.key} className="toolbar" style={{ justifyContent: "space-between" }}>
                  <span>{item.label}</span>
                  <span className={`status-pill ${item.set ? "status-y" : item.required ? "status-n" : "status-pending"}`}>
                    {item.set ? "ตั้งค่าแล้ว" : item.required ? "ยังไม่ได้ตั้งค่า" : "ไม่ได้ตั้งค่า (optional)"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {message ? <div className="status-message">{message}</div> : null}
      </div>
    </Layout>
  );
}
