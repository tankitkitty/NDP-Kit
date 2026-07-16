import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "data", "dbconfig.json");

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbConfig(body: any): DbConfig {
  const host = typeof body?.host === "string" ? body.host.trim() : "";
  const user = typeof body?.user === "string" ? body.user.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const database = typeof body?.database === "string" ? body.database.trim() : "";
  const port = Number(body?.port);

  if (!host) throw new Error("กรุณาระบุ Host");
  if (!user) throw new Error("กรุณาระบุ User");
  if (!database) throw new Error("กรุณาระบุ Database");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Port ไม่ถูกต้อง");
  }

  return { host, port, user, password, database };
}

export function readStoredConfig(): DbConfig | null {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as DbConfig;
  } catch {
    return null;
  }
}

function getConfig(): DbConfig {
  if (process.env.MYSQL_HOST) {
    return {
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "nextjs_app",
    };
  }

  if (!fs.existsSync(configPath)) {
    throw new Error("Database config file not found: data/dbconfig.json");
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as DbConfig;
}

let pool: mysql.Pool | null = null;
let lastConfigJson = "";

function getPool() {
  const dbConfig = getConfig();
  const currentConfigJson = JSON.stringify(dbConfig);

  if (!pool || currentConfigJson !== lastConfigJson) {
    if (pool) {
      pool.end().catch(() => undefined);
    }

    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    // Some MySQL/MariaDB servers (seen on this project's DB: MariaDB 10.0.17)
    // default the session charset to something other than UTF-8 (e.g. tis620)
    // regardless of the driver's `charset` connection option, which corrupts
    // Thai text on insert/select. Force it explicitly on every new connection.
    pool.on("connection", (connection) => {
      // The pool's raw "connection" event always fires with the callback-style
      // connection object at runtime (even though mysql2/promise's types claim
      // otherwise), so this call is fire-and-forget rather than awaited.
      connection.query("SET NAMES utf8mb4");
    });
    lastConfigJson = currentConfigJson;
  }

  return pool;
}

export async function query(sql: string, values?: any[]) {
  const db = getPool();
  const [rows] = await db.query(sql, values);
  return rows;
}

export async function getHospitalName(): Promise<string> {
  try {
    const rows: any = await query("SELECT hospitalname FROM opdconfig LIMIT 1");
    return rows[0]?.hospitalname || "";
  } catch {
    return "";
  }
}

export async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function ensureEligibilityCheckTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS eligibility_check (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vn VARCHAR(20) NULL,
      hn VARCHAR(20) NULL,
      cid VARCHAR(17) NULL,
      patient_name VARCHAR(200) NULL,
      visit_date DATE NULL,
      status ENUM('success','error') NOT NULL,
      claim_type VARCHAR(50) NULL,
      claim_code VARCHAR(100) NULL,
      result_hcode VARCHAR(20) NULL,
      claim_date_time VARCHAR(30) NULL,
      check_date VARCHAR(30) NULL,
      error_message TEXT NULL,
      checked_by VARCHAR(100) NULL,
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_checked_at (checked_at),
      INDEX idx_visit (vn)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// ตาราง log สำรองการแก้ไขสิทธิใน visit_pttype (เก็บในฐานเราเอง แยกจาก HOSxP)
// เก็บค่าเดิมทั้งแถวเป็น JSON (full_before) เพื่อให้กู้คืนได้ครบทุกฟิลด์
export async function ensurePttypeEditLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS pttype_edit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vn VARCHAR(13) NULL,
      pttype_before VARCHAR(2) NULL,
      pttype_after VARCHAR(2) NULL,
      auth_code_before VARCHAR(30) NULL,
      auth_code_after VARCHAR(30) NULL,
      hospmain_before VARCHAR(9) NULL,
      hospmain_after VARCHAR(9) NULL,
      hospsub_before VARCHAR(9) NULL,
      hospsub_after VARCHAR(9) NULL,
      begin_date_before VARCHAR(10) NULL,
      begin_date_after VARCHAR(10) NULL,
      expire_date_before VARCHAR(10) NULL,
      expire_date_after VARCHAR(10) NULL,
      full_before MEDIUMTEXT NULL,
      edited_by VARCHAR(100) NULL,
      edited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vn (vn),
      INDEX idx_edited_at (edited_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// เก็บ log สำรองไว้ 90 วัน แล้วลบอัตโนมัติ (ค่าคงที่ในโค้ด จึงปลอดภัยกับ template)
const PTTYPE_LOG_RETENTION_DAYS = 90;

export async function pruneOldPttypeEditLogs() {
  await query(
    `DELETE FROM pttype_edit_log WHERE edited_at < DATE_SUB(NOW(), INTERVAL ${PTTYPE_LOG_RETENTION_DAYS} DAY)`
  );
}
