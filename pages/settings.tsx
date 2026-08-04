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
  const bootstrap = isBootstrapPhase();
  if (!session && !bootstrap) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  const hospitalName = await getHospitalName();
  const nhsoStatus = getNhsoConfigStatus();
  return {
    props: {
      hospitalName,
      nhsoStatus,
      loginname: session?.loginname ?? null,
      // หน้านี้เปิดให้เข้าได้ตอนยังไม่เคยตั้งค่า แต่การบันทึก/ทดสอบจะต้องแนบ
      // รหัสติดตั้งครั้งแรกไปด้วยเสมอ (ดู lib/authGuard.ts)
      needsSetupToken: !session && bootstrap,
    },
  };
};

type NhsoStatus = { env: string; items: NhsoConfigItem[]; ready: boolean };

type RegisterPreview = { hospitalCode: string; hospitalName: string; version: string };

type UpdateInfo = {
  supported: boolean;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
};

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
  needsSetupToken,
}: {
  hospitalName: string;
  nhsoStatus: NhsoStatus;
  loginname: string | null;
  needsSetupToken: boolean;
}) {
  const [setupToken, setSetupToken] = useState("");
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
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingConfig43, setSavingConfig43] = useState(false);
  const [testingConnection43, setTestingConnection43] = useState(false);
  const [activeTab, setActiveTab] = useState<"main" | "file43" | "nhso">("main");
  const [registerPrompt, setRegisterPrompt] = useState<RegisterPreview | null>(null);
  const [sendingRegister, setSendingRegister] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    // ช่วงติดตั้งครั้งแรกยังไม่มีค่าอะไรให้โหลด และคำขอจะถูกปฏิเสธเพราะยังไม่ได้
    // กรอกรหัส จึงข้ามไปเลยไม่ให้ขึ้นข้อความผิดพลาดค้างหน้าจอตั้งแต่เปิดหน้ามา
    if (needsSetupToken) return;
    fetchConfig();
    fetchConfig43();
    fetchRegisterPrompt();
    checkUpdate();
  }, [needsSetupToken]);

  // ถามเรื่องลงทะเบียนหน่วยบริการครั้งเดียวหลังตั้งค่าเสร็จ
  // ฝั่งเซิร์ฟเวอร์เป็นคนตัดสินว่าควรถามไหม (ปิดฟีเจอร์ไว้ / ตอบไปแล้ว = ไม่ถาม)
  async function fetchRegisterPrompt() {
    try {
      const res = await fetch("/api/register-hospital");
      const data = await res.json();
      if (res.ok && data.shouldAsk) setRegisterPrompt(data.preview);
    } catch {
      // ถามไม่ได้ก็ข้ามไป ไม่ใช่ส่วนที่จำเป็นต่อการใช้งาน
    }
  }

  // manual = ผู้ใช้กดปุ่มเอง จึงควรตอบกลับให้เห็นผลเสมอ
  // ส่วนการตรวจอัตโนมัติตอนเปิดหน้าให้เงียบไว้ ไม่งั้นจะเด้งข้อความทุกครั้งที่เข้าหน้านี้
  async function checkUpdate(manual = false) {
    setCheckingUpdate(true);
    try {
      const res = await fetch("/api/update");
      const data = await res.json();
      if (res.ok) {
        setUpdateInfo(data);
        if (manual && data.supported && !data.hasUpdate) {
          showToast("ใช้เวอร์ชันล่าสุดอยู่แล้ว", "success");
        }
      } else if (manual) {
        showToast(data.error || "ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ", "error");
      }
    } catch {
      if (manual) showToast("ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ", "error");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function runUpdate() {
    const target = updateInfo?.latest || "เวอร์ชันล่าสุด";
    if (!window.confirm(`อัปเดตเป็น ${target} ตอนนี้เลยไหม\n\nโปรแกรมจะปิดและเปิดใหม่เอง ผู้ใช้คนอื่นจะใช้งานไม่ได้ราวหนึ่งนาที\nค่าตั้งค่าทั้งหมดจะไม่หาย`)) {
      return;
    }
    setUpdating(true);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = await res.json();
      if (res.ok) showToast(data.message || "เริ่มอัปเดตแล้ว", "success");
      else {
        showToast(data.error || "เริ่มอัปเดตไม่สำเร็จ", "error");
        setUpdating(false);
      }
      // ระหว่างอัปเดตเซิร์ฟเวอร์จะถูกปิด จึงคงปุ่มเป็นสถานะกำลังทำงานไว้
      // ไม่ปลดล็อกกลับ เพื่อไม่ให้กดซ้ำระหว่างที่ไฟล์กำลังถูกสลับ
    } catch {
      // คำขอขาดกลางคันเป็นเรื่องปกติ เพราะเซิร์ฟเวอร์ถูกปิดไปแล้ว
      showToast("เริ่มอัปเดตแล้ว รอสักครู่แล้วรีเฟรชหน้าเว็บ", "success");
    }
  }

  async function answerRegister(consent: boolean) {
    setSendingRegister(true);
    try {
      const res = await fetch("/api/register-hospital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent }),
      });
      const data = await res.json();
      if (res.ok) {
        setRegisterPrompt(null);
        if (consent) showToast(data.message || "ส่งข้อมูลเรียบร้อย", "success");
      } else {
        // ส่งไม่สำเร็จให้การ์ดค้างไว้ จะได้กดส่งซ้ำเมื่อเน็ตกลับมา
        showToast(data.error || "ส่งข้อมูลไม่สำเร็จ", "error");
      }
    } catch {
      showToast("ส่งข้อมูลไม่สำเร็จ", "error");
    } finally {
      setSendingRegister(false);
    }
  }

  // แนบรหัสติดตั้งไปกับทุกคำขอเฉพาะช่วงติดตั้งครั้งแรก หลังจากนั้นใช้ session ตามปกติ
  function requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (needsSetupToken && setupToken.trim()) headers["x-setup-token"] = setupToken.trim();
    return headers;
  }

  // กันไว้ฝั่งหน้าเว็บก่อน ไม่ให้การกดปุ่มทั้งที่ยังไม่กรอกรหัสไปนับรวมกับ
  // จำนวนครั้งที่ใส่รหัสผิด (ฝั่งเซิร์ฟเวอร์ล็อก 15 นาทีเมื่อผิดครบ 10 ครั้ง)
  function missingSetupToken(): boolean {
    if (needsSetupToken && !setupToken.trim()) {
      showToast("กรุณากรอกรหัสติดตั้งครั้งแรกก่อน", "error");
      return true;
    }
    return false;
  }

  // แจ้งเตือนแบบ toast แล้วหายเองใน 4 วินาที
  function showToast(text: string, type: "success" | "error") {
    setMessage({ text, type });
  }

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (res.ok && data.config) {
        setConfig(data.config);
      } else if (!res.ok) {
        showToast(data.error || "ไม่สามารถโหลดการตั้งค่าได้", "error");
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function saveConfig() {
    const validationError = validateConfig(config);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    if (missingSetupToken()) return;

    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "บันทึกสำเร็จ", "success");
      } else {
        showToast(data.error || "ไม่สามารถบันทึกการตั้งค่าได้", "error");
      }
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setSavingConfig(false);
    }
  }

  async function testConnection() {
    const validationError = validateConfig(config);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    if (missingSetupToken()) return;

    setTestingConnection(true);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "เชื่อมต่อฐานข้อมูลสำเร็จ", "success");
      } else {
        showToast(data.error || "ไม่สามารถเชื่อมต่อฐานข้อมูลได้", "error");
      }
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการทดสอบเชื่อมต่อ", "error");
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
      showToast(validationError, "error");
      return;
    }
    if (missingSetupToken()) return;

    setSavingConfig43(true);
    try {
      const res = await fetch("/api/config43", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(config43),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "บันทึกสำเร็จ", "success");
      } else {
        showToast(data.error || "ไม่สามารถบันทึกการตั้งค่าได้", "error");
      }
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setSavingConfig43(false);
    }
  }

  async function testConnection43() {
    const validationError = validateConfig(config43);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    if (missingSetupToken()) return;

    setTestingConnection43(true);
    try {
      const res = await fetch("/api/test-connection43", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(config43),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "เชื่อมต่อฐานข้อมูลสำเร็จ", "success");
      } else {
        showToast(data.error || "ไม่สามารถเชื่อมต่อฐานข้อมูลได้", "error");
      }
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการทดสอบเชื่อมต่อ", "error");
    } finally {
      setTestingConnection43(false);
    }
  }

  return (
    <Layout title="ตั้งค่าการเชื่อมต่อ" hospitalName={hospitalName} loginname={loginname || undefined}>
      <div className="page-card">
        <div className="brand" style={{ marginBottom: 20 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>ตั้งค่าการเชื่อมต่อ</h1>
        </div>

        {needsSetupToken ? (
          <div className="add-item-card" style={{ maxWidth: 560, marginBottom: 20 }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>ตั้งค่าครั้งแรก</h2>
            <p style={{ marginTop: 0, color: "var(--muted)" }}>
              เครื่องนี้ยังไม่เคยตั้งค่าฐานข้อมูล จึงยังเข้าสู่ระบบไม่ได้ —
              กรอกรหัสที่แสดงบนหน้าจอตัวช่วยติดตั้งเพื่อยืนยันว่าคุณคือผู้ติดตั้ง
              เมื่อบันทึกการตั้งค่าสำเร็จ รหัสนี้จะใช้ไม่ได้อีก
            </p>
            <div className="label-group">
              <label>รหัสติดตั้งครั้งแรก</label>
              <input
                className="input-field"
                value={setupToken}
                placeholder="เช่น ABCD-2345"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {updateInfo?.supported ? (
          <div className="add-item-card" style={{ maxWidth: 560, marginBottom: 20 }}>
            <div className="section-header">
              <h2 className="section-title" style={{ margin: 0 }}>เวอร์ชันโปรแกรม</h2>
              <span className={`status-pill ${updateInfo.hasUpdate ? "status-pending" : "status-y"}`}>
                {updateInfo.hasUpdate ? `มีเวอร์ชันใหม่ ${updateInfo.latest}` : "ล่าสุดแล้ว"}
              </span>
            </div>
            <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <span>เวอร์ชันที่ใช้อยู่</span>
              <strong>{updateInfo.current || "(ไม่ทราบ)"}</strong>
            </div>
            {updateInfo.hasUpdate ? (
              <p style={{ marginTop: 0, color: "var(--muted)" }}>
                กดอัปเดตแล้วโปรแกรมจะดาวน์โหลดเวอร์ชันใหม่จาก GitHub ปิดตัวเองและเปิดใหม่โดยอัตโนมัติ
                ใช้เวลาราวหนึ่งนาที <strong>ค่าตั้งค่าทั้งหมดไม่หาย</strong> ถ้าอัปเดตล้มเหลวระบบจะย้อนกลับ
                เป็นเวอร์ชันเดิมให้เอง ควรทำตอนไม่มีคนใช้งาน
              </p>
            ) : null}
            <div className="toolbar">
              <button className="button-ghost" onClick={() => checkUpdate(true)} disabled={checkingUpdate || updating}>
                {checkingUpdate ? "กำลังตรวจสอบ..." : "ตรวจสอบเวอร์ชันใหม่"}
              </button>
              {updateInfo.hasUpdate ? (
                <button className="button-primary" onClick={runUpdate} disabled={updating}>
                  {updating ? "กำลังอัปเดต..." : `อัปเดตเป็น ${updateInfo.latest}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {registerPrompt ? (
          <div className="add-item-card" style={{ maxWidth: 560, marginBottom: 20 }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>ลงทะเบียนหน่วยบริการ</h2>
            <p style={{ marginTop: 0, color: "var(--muted)" }}>
              ส่งข้อมูลด้านล่างให้ผู้พัฒนา เพื่อให้ทราบว่ามีหน่วยบริการใดใช้งานอยู่บ้าง
              และแจ้งเตือนได้เมื่อมีเวอร์ชันใหม่ — <strong>ไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคล</strong>
              ถามครั้งเดียว ไม่ส่งก็ใช้งานได้ตามปกติทุกอย่าง
            </p>
            <div className="grid-form" style={{ marginBottom: 12 }}>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <span>รหัสสถานพยาบาล</span>
                <strong>{registerPrompt.hospitalCode || "(ไม่พบในฐานข้อมูล)"}</strong>
              </div>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <span>ชื่อสถานพยาบาล</span>
                <strong>{registerPrompt.hospitalName || "(ไม่พบในฐานข้อมูล)"}</strong>
              </div>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <span>เวอร์ชันที่ใช้</span>
                <strong>{registerPrompt.version || "(ไม่ทราบ)"}</strong>
              </div>
            </div>
            <div className="toolbar">
              <button className="button-primary" onClick={() => answerRegister(true)} disabled={sendingRegister}>
                {sendingRegister ? "กำลังส่ง..." : "ส่งข้อมูล"}
              </button>
              <button className="button-ghost" onClick={() => answerRegister(false)} disabled={sendingRegister}>
                ไม่ส่ง
              </button>
            </div>
          </div>
        ) : null}

        <div className="tabs">
          <button className={`tab ${activeTab === "main" ? "active" : ""}`} onClick={() => setActiveTab("main")}>
            ฐานข้อมูลหลัก
          </button>
          <button className={`tab ${activeTab === "file43" ? "active" : ""}`} onClick={() => setActiveTab("file43")}>
            ฐานข้อมูล 43 แฟ้ม
          </button>
          <button className={`tab ${activeTab === "nhso" ? "active" : ""}`} onClick={() => setActiveTab("nhso")}>
            NHSO API
          </button>
        </div>

        {activeTab === "main" ? (
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
        ) : null}

        {activeTab === "file43" ? (
        <section>
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
        ) : null}

        {activeTab === "nhso" ? (
        <section>
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
        ) : null}

      </div>

      {message ? (
        <div className={`toast toast-${message.type}`} role="alert" onClick={() => setMessage(null)}>
          <span className="toast-icon">{message.type === "success" ? "✓" : "✕"}</span>
          <span>{message.text}</span>
          <button className="toast-close" onClick={() => setMessage(null)} aria-label="ปิด">
            ×
          </button>
        </div>
      ) : null}
    </Layout>
  );
}
