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
