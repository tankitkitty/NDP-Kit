import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "data", "dbconfig43.json");

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbConfig43(body: any): DbConfig {
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

export function readStoredConfig43(): DbConfig | null {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as DbConfig;
  } catch {
    return null;
  }
}

function getConfig(): DbConfig {
  if (process.env.FILE43_MYSQL_HOST) {
    return {
      host: process.env.FILE43_MYSQL_HOST,
      port: Number(process.env.FILE43_MYSQL_PORT || 3306),
      user: process.env.FILE43_MYSQL_USER || "root",
      password: process.env.FILE43_MYSQL_PASSWORD || "",
      database: process.env.FILE43_MYSQL_DATABASE || "",
    };
  }

  if (!fs.existsSync(configPath)) {
    throw new Error("Database config file not found: data/dbconfig43.json");
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

export async function query43(sql: string, values?: any[]) {
  const db = getPool();
  const [rows] = await db.query(sql, values);
  return rows;
}

export const SCHEMA43_TABLES = [
  "accident",
  "address",
  "admission",
  "anc",
  "appointment",
  "community_service",
  "card",
  "care_refer",
  "charge_ipd",
  "charge_opd",
  "chronic",
  "chronicfu",
  "clinical_refer",
  "community_activity",
  "drugallergy",
  "data_correct",
  "death",
  "dental",
  "diagnosis_ipd",
  "diagnosis_opd",
  "disability",
  "drug_ipd",
  "drug_opd",
  "drug_refer",
  "epi",
  "fp",
  "functional",
  "home",
  "icf",
  "investigation_refer",
  "nutrition",
  "labfu",
  "labor",
  "ncdscreen",
  "newborn",
  "newborncare",
  "provider",
  "policy",
  "postnatal",
  "prenatal",
  "procedure_ipd",
  "procedure_opd",
  "procedure_refer",
  "person",
  "rehabilitation",
  "refer_history",
  "refer_result",
  "women",
  "service",
  "specialpp",
  "surveillance",
  "village",
];

export async function getExistingTables43(): Promise<string[]> {
  const rows = (await query43(
    `SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [SCHEMA43_TABLES]
  )) as any[];
  return rows.map((r) => r.name);
}

export async function initializeSchema43() {
  await query43(`
    CREATE TABLE IF NOT EXISTS accident (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      datetime_serv VARCHAR(14) NULL,
      datetime_ae VARCHAR(14) NULL,
      aetype VARCHAR(1) NULL,
      aeplace VARCHAR(1) NULL,
      typein_ae VARCHAR(1) NULL,
      traffic VARCHAR(1) NULL,
      vehicle VARCHAR(1) NULL,
      alcohol VARCHAR(1) NULL,
      nacrotic_drug VARCHAR(1) NULL,
      belt VARCHAR(1) NULL,
      helmet VARCHAR(1) NULL,
      airway VARCHAR(1) NULL,
      stopbleed VARCHAR(1) NULL,
      splint VARCHAR(1) NULL,
      fluid VARCHAR(1) NULL,
      urgency VARCHAR(1) NULL,
      coma_eye VARCHAR(1) NULL,
      coma_speak VARCHAR(1) NULL,
      coma_movement VARCHAR(1) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS address (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      addresstype VARCHAR(1) NOT NULL,
      house_id VARCHAR(15) NULL,
      housetype VARCHAR(1) NULL,
      roomno VARCHAR(20) NULL,
      condo VARCHAR(100) NULL,
      houseno VARCHAR(20) NULL,
      soisub VARCHAR(100) NULL,
      soimain VARCHAR(100) NULL,
      road VARCHAR(100) NULL,
      villaname VARCHAR(100) NULL,
      village VARCHAR(2) NULL,
      tambon VARCHAR(2) NULL,
      ampur VARCHAR(2) NULL,
      changwat VARCHAR(2) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, addresstype)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS admission (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      an VARCHAR(9) NOT NULL,
      datetime_admit VARCHAR(14) NULL,
      wardadmit VARCHAR(5) NULL,
      instype VARCHAR(4) NULL,
      typein VARCHAR(1) NULL,
      referinhosp VARCHAR(5) NULL,
      causein VARCHAR(1) NULL,
      admitweight DECIMAL(6,1) NULL,
      admitheight DECIMAL(5,1) NULL,
      datetime_disch VARCHAR(14) NULL,
      warddisch VARCHAR(5) NULL,
      dischstatus VARCHAR(1) NULL,
      dischtype VARCHAR(1) NULL,
      referouthosp VARCHAR(5) NULL,
      causeout VARCHAR(1) NULL,
      cost DECIMAL(12,2) NULL,
      price DECIMAL(12,2) NULL,
      payprice DECIMAL(12,2) NULL,
      actualpay DECIMAL(12,2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      drg VARCHAR(5) NULL,
      rw DECIMAL(7,4) NULL,
      adjrw DECIMAL(7,4) NULL,
      error VARCHAR(2) NULL,
      warning VARCHAR(4) NULL,
      actlos VARCHAR(6) NULL,
      grouper_version VARCHAR(10) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, an),
      KEY idx_admission_pid (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS anc (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      gravida VARCHAR(1) NULL,
      ancno VARCHAR(2) NULL,
      ga VARCHAR(2) NULL,
      ancresult VARCHAR(1) NULL,
      ancplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      weight DECIMAL(5,1) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS appointment (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      an VARCHAR(9) NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      clinic VARCHAR(5) NULL,
      apdate VARCHAR(8) NOT NULL,
      aptype VARCHAR(3) NULL,
      apdiag VARCHAR(10) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, apdate)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS community_service (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      comservice VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS card (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      instype_old VARCHAR(5) NULL,
      instype_new VARCHAR(5) NOT NULL,
      insid VARCHAR(50) NULL,
      startdate VARCHAR(8) NOT NULL,
      expiredate VARCHAR(8) NULL,
      main VARCHAR(5) NULL,
      sub VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, instype_new, startdate)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS care_refer (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      caretype VARCHAR(5) NOT NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid, caretype)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS charge_ipd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      an VARCHAR(9) NOT NULL,
      datetime_admit VARCHAR(14) NULL,
      wardstay VARCHAR(5) NOT NULL,
      chargeitem VARCHAR(5) NOT NULL,
      chargelist VARCHAR(10) NOT NULL,
      quantity DECIMAL(10,2) NULL,
      instype VARCHAR(4) NULL,
      cost DECIMAL(12,2) NULL,
      price DECIMAL(12,2) NULL,
      payprice DECIMAL(12,2) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, an, wardstay, chargeitem, chargelist)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS charge_opd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      clinic VARCHAR(5) NULL,
      chargeitem VARCHAR(5) NOT NULL,
      chargelist VARCHAR(10) NOT NULL,
      quantity DECIMAL(10,2) NULL,
      instype VARCHAR(4) NULL,
      cost DECIMAL(12,2) NULL,
      price DECIMAL(12,2) NULL,
      payprice DECIMAL(12,2) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, chargeitem, chargelist)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS chronic (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      date_diag VARCHAR(8) NOT NULL,
      chronic VARCHAR(10) NOT NULL,
      hosp_dx VARCHAR(5) NULL,
      hosp_rx VARCHAR(5) NULL,
      date_disch VARCHAR(8) NULL,
      typedisch VARCHAR(2) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, date_diag, chronic)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS chronicfu (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      weight DECIMAL(6,1) NULL,
      height DECIMAL(5,1) NULL,
      waist_cm DECIMAL(5,1) NULL,
      sbp DECIMAL(5,1) NULL,
      dbp DECIMAL(5,1) NULL,
      foot VARCHAR(2) NULL,
      retina VARCHAR(2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      chronicfuplace VARCHAR(5) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS clinical_refer (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      datetime_assess VARCHAR(14) NOT NULL,
      clinicalcode VARCHAR(10) NOT NULL,
      clinicalname VARCHAR(100) NULL,
      clinicalvalue VARCHAR(20) NULL,
      clinicalresult VARCHAR(10) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid, datetime_assess, clinicalcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS community_activity (
      hospcode VARCHAR(5) NOT NULL,
      vid VARCHAR(20) NOT NULL,
      date_start VARCHAR(8) NOT NULL,
      date_finish VARCHAR(8) NULL,
      comactivity VARCHAR(5) NOT NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, vid, date_start, comactivity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS drugallergy (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      daterecord VARCHAR(8) NOT NULL,
      drugallergy VARCHAR(30) NOT NULL,
      dname VARCHAR(200) NULL,
      typedx VARCHAR(1) NULL,
      alevel VARCHAR(1) NULL,
      symptom VARCHAR(200) NULL,
      informant VARCHAR(1) NULL,
      informhosp VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      provider VARCHAR(5) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, daterecord, drugallergy)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS data_correct (
      hospcode VARCHAR(5) NOT NULL,
      tablename VARCHAR(30) NOT NULL,
      data_correct VARCHAR(1) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, tablename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS death (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      hospdeath VARCHAR(5) NULL,
      an VARCHAR(9) NULL,
      seq VARCHAR(20) NULL,
      ddeath VARCHAR(8) NULL,
      cdeath_a VARCHAR(5) NULL,
      cdeath_b VARCHAR(5) NULL,
      cdeath_c VARCHAR(5) NULL,
      cdeath_d VARCHAR(5) NULL,
      odisease VARCHAR(5) NULL,
      cdeath VARCHAR(5) NULL,
      pregdeath VARCHAR(1) NULL,
      pdeath VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS dental (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      denttype VARCHAR(1) NULL,
      servplace VARCHAR(1) NULL,
      pteeth VARCHAR(2) NULL,
      pcaries VARCHAR(2) NULL,
      pfilling VARCHAR(2) NULL,
      pextract VARCHAR(2) NULL,
      dteeth VARCHAR(2) NULL,
      dcaries VARCHAR(2) NULL,
      dfilling VARCHAR(2) NULL,
      dextract VARCHAR(2) NULL,
      need_fluoride VARCHAR(1) NULL,
      need_scaling VARCHAR(1) NULL,
      need_sealant VARCHAR(1) NULL,
      need_pfilling VARCHAR(2) NULL,
      need_dfilling VARCHAR(2) NULL,
      need_pextract VARCHAR(2) NULL,
      need_dextract VARCHAR(2) NULL,
      nprosthesis VARCHAR(1) NULL,
      permanent_permanent VARCHAR(2) NULL,
      permanent_prosthesis VARCHAR(2) NULL,
      prosthesis_prosthesis VARCHAR(6) NULL,
      gum VARCHAR(6) NULL,
      schooltype VARCHAR(1) NULL,
      class VARCHAR(4) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS diagnosis_ipd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      an VARCHAR(9) NOT NULL,
      datetime_admit VARCHAR(14) NULL,
      warddiag VARCHAR(5) NOT NULL,
      diagtype VARCHAR(1) NOT NULL,
      diagcode VARCHAR(10) NOT NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, an, warddiag, diagtype, diagcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS diagnosis_opd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      diagtype VARCHAR(1) NOT NULL,
      diagcode VARCHAR(10) NOT NULL,
      clinic VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, diagtype, diagcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS disability (
      hospcode VARCHAR(5) NOT NULL,
      disabid VARCHAR(20) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      disabtype VARCHAR(2) NOT NULL,
      disabcause VARCHAR(2) NULL,
      diagcode VARCHAR(10) NULL,
      date_detect VARCHAR(8) NULL,
      date_disab VARCHAR(8) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, disabid, disabtype)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS drug_ipd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      an VARCHAR(9) NOT NULL,
      datetime_admit VARCHAR(14) NULL,
      wardstay VARCHAR(5) NOT NULL,
      typedrug VARCHAR(1) NULL,
      didstd VARCHAR(30) NOT NULL,
      dname VARCHAR(200) NULL,
      datestart VARCHAR(8) NOT NULL,
      datefinish VARCHAR(8) NULL,
      amount DECIMAL(10,2) NULL,
      unit VARCHAR(3) NULL,
      unit_packing VARCHAR(3) NULL,
      drugprice DECIMAL(10,2) NULL,
      drugcost DECIMAL(10,2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, an, wardstay, didstd, datestart)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS drug_opd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      clinic VARCHAR(5) NULL,
      didstd VARCHAR(30) NOT NULL,
      dname VARCHAR(200) NULL,
      amount DECIMAL(10,2) NULL,
      unit VARCHAR(3) NULL,
      unit_packing VARCHAR(3) NULL,
      drugprice DECIMAL(10,2) NULL,
      drugcost DECIMAL(10,2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, didstd)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS drug_refer (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      datetime_dstart VARCHAR(14) NOT NULL,
      datetime_dfinish VARCHAR(14) NULL,
      didstd VARCHAR(30) NOT NULL,
      dname VARCHAR(200) NULL,
      ddescription VARCHAR(500) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid, datetime_dstart, didstd)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS investigation_refer (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      datetime_invest VARCHAR(14) NOT NULL,
      investcode VARCHAR(10) NOT NULL,
      investname VARCHAR(100) NULL,
      datetime_report VARCHAR(14) NULL,
      investvalue VARCHAR(50) NULL,
      investresult VARCHAR(50) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid, datetime_invest, investcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS epi (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      vaccinetype VARCHAR(3) NOT NULL,
      vaccineplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, vaccinetype)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS fp (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      fptype VARCHAR(2) NULL,
      fpplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS functional (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      functional_test VARCHAR(3) NOT NULL,
      testresult VARCHAR(3) NULL,
      dependent VARCHAR(1) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, functional_test)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS home (
      hospcode VARCHAR(5) NOT NULL,
      hid VARCHAR(8) NOT NULL,
      house_id VARCHAR(15) NULL,
      housetype VARCHAR(1) NULL,
      roomno VARCHAR(20) NULL,
      condo VARCHAR(100) NULL,
      house VARCHAR(20) NULL,
      soisub VARCHAR(100) NULL,
      soimain VARCHAR(100) NULL,
      road VARCHAR(100) NULL,
      villaname VARCHAR(100) NULL,
      village VARCHAR(2) NULL,
      tambon VARCHAR(2) NULL,
      ampur VARCHAR(2) NULL,
      changwat VARCHAR(2) NULL,
      telephone VARCHAR(20) NULL,
      latitude DECIMAL(10,6) NULL,
      longitude DECIMAL(10,6) NULL,
      nfamily VARCHAR(5) NULL,
      locatype VARCHAR(1) NULL,
      vhvid VARCHAR(15) NULL,
      headid VARCHAR(15) NULL,
      toilet VARCHAR(1) NULL,
      water VARCHAR(1) NULL,
      watertype VARCHAR(1) NULL,
      garbage VARCHAR(1) NULL,
      housing VARCHAR(1) NULL,
      durability VARCHAR(1) NULL,
      cleanliness VARCHAR(1) NULL,
      ventilation VARCHAR(1) NULL,
      light VARCHAR(1) NULL,
      watertm VARCHAR(6) NULL,
      mfood VARCHAR(1) NULL,
      bcontrol VARCHAR(1) NULL,
      acontrol VARCHAR(1) NULL,
      chemical VARCHAR(1) NULL,
      outdate VARCHAR(8) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, hid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS icf (
      hospcode VARCHAR(5) NOT NULL,
      disabid VARCHAR(20) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      icf VARCHAR(10) NOT NULL,
      qualifier VARCHAR(2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, disabid, seq, icf)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS nutrition (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      nutritionplace VARCHAR(5) NULL,
      weight DECIMAL(6,1) NULL,
      height DECIMAL(5,1) NULL,
      headcircum DECIMAL(5,1) NULL,
      childdevelop VARCHAR(2) NULL,
      food VARCHAR(1) NULL,
      bottle VARCHAR(1) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS labfu (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      labtest VARCHAR(10) NOT NULL,
      labresult VARCHAR(200) NULL,
      d_update VARCHAR(14) NULL,
      labplace VARCHAR(5) NULL,
      cid VARCHAR(17) NULL,
      provider VARCHAR(5) NULL,
      PRIMARY KEY (hospcode, pid, seq, labtest)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS labor (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      gravida VARCHAR(1) NULL,
      lmp VARCHAR(8) NULL,
      edc VARCHAR(8) NULL,
      bdate VARCHAR(8) NOT NULL,
      bresult VARCHAR(10) NULL,
      bplace VARCHAR(1) NULL,
      bhosp VARCHAR(5) NULL,
      btype VARCHAR(1) NULL,
      bdoctor VARCHAR(1) NULL,
      lborn VARCHAR(1) NULL,
      sborn VARCHAR(1) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, bdate)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS ncdscreen (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      servplace VARCHAR(5) NULL,
      smoke VARCHAR(1) NULL,
      alcohol VARCHAR(1) NULL,
      dmfamily VARCHAR(1) NULL,
      htfamily VARCHAR(1) NULL,
      weight DECIMAL(6,1) NULL,
      height DECIMAL(5,1) NULL,
      waist_cm DECIMAL(5,1) NULL,
      sbp_1 DECIMAL(5,1) NULL,
      dbp_1 DECIMAL(5,1) NULL,
      sbp_2 DECIMAL(5,1) NULL,
      dbp_2 DECIMAL(5,1) NULL,
      bslevel DECIMAL(6,1) NULL,
      bstest VARCHAR(1) NULL,
      screenplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS newborn (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      mpid VARCHAR(15) NULL,
      gravida VARCHAR(1) NULL,
      ga VARCHAR(2) NULL,
      bdate VARCHAR(8) NOT NULL,
      btime VARCHAR(4) NULL,
      bplace VARCHAR(1) NULL,
      bhosp VARCHAR(5) NULL,
      birthno VARCHAR(1) NULL,
      btype VARCHAR(1) NULL,
      bdoctor VARCHAR(1) NULL,
      bweight DECIMAL(6,1) NULL,
      asphyxia VARCHAR(1) NULL,
      vitk VARCHAR(1) NULL,
      tsh VARCHAR(1) NULL,
      tshresult VARCHAR(10) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      length DECIMAL(5,1) NULL,
      headcircum DECIMAL(5,1) NULL,
      PRIMARY KEY (hospcode, pid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS newborncare (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      bdate VARCHAR(8) NULL,
      bcare VARCHAR(5) NULL,
      bcplace VARCHAR(5) NULL,
      bcareresult VARCHAR(10) NULL,
      food VARCHAR(1) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS provider (
      hospcode VARCHAR(5) NOT NULL,
      provider VARCHAR(10) NOT NULL,
      registerno VARCHAR(20) NULL,
      council VARCHAR(2) NULL,
      cid VARCHAR(17) NULL,
      prename VARCHAR(5) NULL,
      name VARCHAR(100) NULL,
      lname VARCHAR(100) NULL,
      sex VARCHAR(1) NULL,
      birth VARCHAR(8) NULL,
      providertype VARCHAR(3) NULL,
      startdate VARCHAR(8) NULL,
      outdate VARCHAR(8) NULL,
      movefrom VARCHAR(5) NULL,
      moveto VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, provider)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS policy (
      hospcode VARCHAR(5) NOT NULL,
      policy_id VARCHAR(20) NOT NULL,
      policy_year VARCHAR(4) NULL,
      policy_data VARCHAR(255) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, policy_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS postnatal (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      gravida VARCHAR(1) NULL,
      bdate VARCHAR(8) NULL,
      ppcare VARCHAR(8) NULL,
      ppplace VARCHAR(5) NULL,
      ppresult VARCHAR(2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS prenatal (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      gravida VARCHAR(1) NOT NULL,
      lmp VARCHAR(8) NULL,
      edc VARCHAR(8) NULL,
      vdrl_result VARCHAR(2) NULL,
      hb_result VARCHAR(2) NULL,
      hiv_result VARCHAR(2) NULL,
      date_hct VARCHAR(8) NULL,
      hct_result DECIMAL(5,1) NULL,
      thalassemia VARCHAR(2) NULL,
      d_update VARCHAR(14) NULL,
      provider VARCHAR(5) NULL,
      cid VARCHAR(17) NULL,
      height DECIMAL(5,1) NULL,
      PRIMARY KEY (hospcode, pid, gravida)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS procedure_ipd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      an VARCHAR(20) NOT NULL,
      datetime_admit VARCHAR(14) NULL,
      wardstay VARCHAR(5) NULL,
      procedcode VARCHAR(10) NOT NULL,
      timestart VARCHAR(14) NOT NULL,
      timefinish VARCHAR(14) NULL,
      serviceprice DECIMAL(10,2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, an, procedcode, timestart)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS procedure_opd (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      clinic VARCHAR(5) NULL,
      procedcode VARCHAR(10) NOT NULL,
      serviceprice DECIMAL(10,2) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, procedcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS procedure_refer (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(20) NULL,
      timestart VARCHAR(14) NULL,
      timefinish VARCHAR(14) NULL,
      procedurename VARCHAR(200) NULL,
      procedcode VARCHAR(10) NOT NULL,
      pdescription VARCHAR(200) NULL,
      procedresult VARCHAR(200) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid, procedcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS person (
      hospcode VARCHAR(5) NOT NULL,
      cid VARCHAR(17) NULL,
      pid VARCHAR(15) NOT NULL,
      hid VARCHAR(10) NULL,
      prename VARCHAR(5) NULL,
      name VARCHAR(100) NULL,
      lname VARCHAR(100) NULL,
      hn VARCHAR(20) NULL,
      sex VARCHAR(1) NULL,
      birth VARCHAR(8) NULL,
      mstatus VARCHAR(1) NULL,
      occupation_old VARCHAR(5) NULL,
      occupation_new VARCHAR(5) NULL,
      race VARCHAR(3) NULL,
      nation VARCHAR(3) NULL,
      religion VARCHAR(2) NULL,
      education VARCHAR(2) NULL,
      fstatus VARCHAR(1) NULL,
      father VARCHAR(17) NULL,
      mother VARCHAR(17) NULL,
      couple VARCHAR(17) NULL,
      vstatus VARCHAR(1) NULL,
      movein VARCHAR(8) NULL,
      discharge VARCHAR(2) NULL,
      ddischarge VARCHAR(8) NULL,
      abogroup VARCHAR(1) NULL,
      rhgroup VARCHAR(1) NULL,
      labor VARCHAR(1) NULL,
      passport VARCHAR(20) NULL,
      typearea VARCHAR(1) NULL,
      d_update VARCHAR(14) NULL,
      telephone VARCHAR(20) NULL,
      mobile VARCHAR(20) NULL,
      PRIMARY KEY (hospcode, pid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS rehabilitation (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      an VARCHAR(9) NOT NULL,
      date_admit VARCHAR(14) NULL,
      date_serv VARCHAR(8) NULL,
      date_start VARCHAR(8) NOT NULL,
      date_finish VARCHAR(8) NULL,
      rehabcode VARCHAR(10) NOT NULL,
      at_device VARCHAR(10) NOT NULL,
      at_no DECIMAL(5,0) NULL,
      rehabplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, an, date_start, rehabcode, at_device)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS refer_history (
      hospcode VARCHAR(5) NOT NULL,
      referid VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      pid VARCHAR(15) NULL,
      seq VARCHAR(20) NULL,
      an VARCHAR(9) NULL,
      referid_origin VARCHAR(20) NULL,
      hospcode_origin VARCHAR(5) NULL,
      datetime_serv VARCHAR(14) NULL,
      datetime_admit VARCHAR(14) NULL,
      datetime_refer VARCHAR(14) NULL,
      clinic_refer VARCHAR(5) NULL,
      hosp_destination VARCHAR(5) NULL,
      chiefcomp TEXT NULL,
      physicalexam TEXT NULL,
      diagfirst VARCHAR(255) NULL,
      diaglast VARCHAR(255) NULL,
      pstatus VARCHAR(1) NULL,
      ptype VARCHAR(1) NULL,
      emergency VARCHAR(2) NULL,
      ptypedis VARCHAR(2) NULL,
      causeout VARCHAR(2) NULL,
      request TEXT NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS refer_result (
      hospcode VARCHAR(5) NOT NULL,
      referid_source VARCHAR(20) NOT NULL,
      referid_province VARCHAR(5) NULL,
      hosp_source VARCHAR(5) NULL,
      refer_result VARCHAR(2) NULL,
      datetime_in VARCHAR(14) NULL,
      pid_in VARCHAR(15) NULL,
      an_in VARCHAR(9) NULL,
      reason VARCHAR(255) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, referid_source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS women (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      fptype VARCHAR(2) NULL,
      nofpcause VARCHAR(2) NULL,
      totalson VARCHAR(2) NULL,
      numberson VARCHAR(2) NULL,
      abortion VARCHAR(2) NULL,
      stillbirth VARCHAR(2) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS service (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      hn VARCHAR(20) NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      time_serv VARCHAR(6) NULL,
      location VARCHAR(1) NULL,
      intime VARCHAR(1) NULL,
      instype VARCHAR(4) NULL,
      insid VARCHAR(20) NULL,
      main VARCHAR(5) NULL,
      typein VARCHAR(1) NULL,
      referinhosp VARCHAR(5) NULL,
      causein VARCHAR(1) NULL,
      chiefcomp TEXT NULL,
      servplace VARCHAR(1) NULL,
      btemp DECIMAL(4,1) NULL,
      sbp DECIMAL(5,1) NULL,
      dbp DECIMAL(5,1) NULL,
      pr DECIMAL(5,1) NULL,
      rr DECIMAL(5,1) NULL,
      typeout VARCHAR(1) NULL,
      referouthosp VARCHAR(5) NULL,
      causeout VARCHAR(1) NULL,
      cost DECIMAL(12,2) NULL,
      price DECIMAL(12,2) NULL,
      payprice DECIMAL(12,2) NULL,
      actualpay DECIMAL(12,2) NULL,
      d_update VARCHAR(14) NULL,
      hsub VARCHAR(5) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS specialpp (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      servplace VARCHAR(5) NULL,
      ppspecial VARCHAR(10) NOT NULL,
      ppsplace VARCHAR(5) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq, ppspecial)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS surveillance (
      hospcode VARCHAR(5) NOT NULL,
      pid VARCHAR(15) NOT NULL,
      seq VARCHAR(20) NOT NULL,
      date_serv VARCHAR(8) NULL,
      an VARCHAR(9) NULL,
      datetime_admit VARCHAR(14) NULL,
      syndrome VARCHAR(10) NULL,
      diagcode VARCHAR(10) NULL,
      code506 VARCHAR(10) NULL,
      diagcodelast VARCHAR(10) NULL,
      code506last VARCHAR(10) NULL,
      illdate VARCHAR(8) NULL,
      illhouse VARCHAR(15) NULL,
      illvillage VARCHAR(2) NULL,
      illtambon VARCHAR(2) NULL,
      illampur VARCHAR(2) NULL,
      illchangwat VARCHAR(2) NULL,
      latitude DECIMAL(10,6) NULL,
      longitude DECIMAL(10,6) NULL,
      ptstatus VARCHAR(1) NULL,
      date_death VARCHAR(8) NULL,
      complication VARCHAR(200) NULL,
      organism VARCHAR(100) NULL,
      provider VARCHAR(5) NULL,
      d_update VARCHAR(14) NULL,
      cid VARCHAR(17) NULL,
      PRIMARY KEY (hospcode, pid, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query43(`
    CREATE TABLE IF NOT EXISTS village (
      hospcode VARCHAR(5) NOT NULL,
      vid VARCHAR(8) NOT NULL,
      ntraditional VARCHAR(3) NULL,
      nmonk VARCHAR(3) NULL,
      nreligionleader VARCHAR(3) NULL,
      nbroadcast VARCHAR(3) NULL,
      nradio VARCHAR(3) NULL,
      npchc VARCHAR(3) NULL,
      nclinic VARCHAR(3) NULL,
      ndrugstore VARCHAR(3) NULL,
      nchildcenter VARCHAR(3) NULL,
      npschool VARCHAR(3) NULL,
      nsschool VARCHAR(3) NULL,
      ntemple VARCHAR(3) NULL,
      nreligiousplace VARCHAR(3) NULL,
      nmarket VARCHAR(3) NULL,
      nshop VARCHAR(3) NULL,
      nfoodshop VARCHAR(3) NULL,
      nstall VARCHAR(3) NULL,
      nraintank VARCHAR(3) NULL,
      nchickenfarm VARCHAR(3) NULL,
      npigfarm VARCHAR(3) NULL,
      wastewater VARCHAR(1) NULL,
      garbage VARCHAR(1) NULL,
      nfactory VARCHAR(3) NULL,
      latitude DECIMAL(10,6) NULL,
      longitude DECIMAL(10,6) NULL,
      outdate VARCHAR(8) NULL,
      numactually VARCHAR(5) NULL,
      risktype VARCHAR(2) NULL,
      numstateless VARCHAR(5) NULL,
      nexerciseclub VARCHAR(3) NULL,
      nolderlyclub VARCHAR(3) NULL,
      ndisableclub VARCHAR(3) NULL,
      nnumberoneclub VARCHAR(3) NULL,
      d_update VARCHAR(14) NULL,
      PRIMARY KEY (hospcode, vid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
