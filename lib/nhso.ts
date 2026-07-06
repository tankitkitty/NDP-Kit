import crypto from "crypto";
import fs from "fs";

const BASE_URLS: Record<string, string> = {
  uat: "https://uat-api-dplatform.uat.krungthai.com",
  production: "https://api-nhsodp.nhso.go.th",
};

function getBaseUrl(): string {
  const env = (process.env.NHSO_ENV || "uat").toLowerCase();
  return BASE_URLS[env] || BASE_URLS.uat;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getPublicKey(): string {
  const inline = process.env.NHSO_PUBLIC_KEY;
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = process.env.NHSO_PUBLIC_KEY_PATH;
  if (path) return fs.readFileSync(path, "utf-8");
  throw new Error("Missing NHSO_PUBLIC_KEY or NHSO_PUBLIC_KEY_PATH");
}

function generateRequestId(hcode: string): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    hcode +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3)
  );
}

function encryptForNhso(plainText: string): string {
  const encrypted = crypto.publicEncrypt(
    {
      key: getPublicKey(),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(plainText, "utf-8")
  );
  return encrypted.toString("base64");
}

function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

let cachedToken: { token: string; exp: number } | null = null;

async function signOn(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) {
    return cachedToken.token;
  }

  const hcode = requireEnv("NHSO_CLIENT_ID");
  const clientSecret = requireEnv("NHSO_CLIENT_SECRET");
  const sourceId = requireEnv("NHSO_SOURCE_ID");
  const sourceIdKey = requireEnv("NHSO_SOURCE_ID_KEY");
  const fdhKey = process.env.NHSO_FDH_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Request-id": generateRequestId(hcode),
    "x-source-id": sourceId,
    "x-sourceid-key": encryptForNhso(sourceIdKey),
  };
  if (fdhKey) {
    headers["x-fdh-key"] = encryptForNhso(fdhKey);
  }

  const res = await fetch(`${getBaseUrl()}/stddataset/api/v2/sign-on`, {
    method: "POST",
    headers,
    body: JSON.stringify({ client_id: hcode, client_secret: clientSecret }),
  });

  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(data.errorDesc || `NHSO sign-on failed (HTTP ${res.status})`);
  }

  const exp = decodeJwtExp(data.token) || now + 15 * 60;
  cachedToken = { token: data.token, exp };
  return data.token;
}

export type NhsoStatement = {
  name?: string;
  datetime?: string;
  runDatetime?: string;
  batchNo?: string;
  period?: string;
  reportNo?: string;
  docNo?: string;
  subFundInfo?: { subFund?: string; activity?: string; budgetNo?: string }[];
};

export type NhsoStatusResult = {
  uid: string;
  e2eId?: string;
  seq?: string;
  hcode?: string;
  an?: string;
  hn?: string;
  claimType?: string;
  refE2eId?: string;
  recordStatus?: string;
  status?: { code: string; message: string };
  results?: { code: string; message: string; solution: string; allowClaim: string }[];
  claimItems?: any[];
  claimSummary?: any;
  apportionments?: any[];
  statements?: NhsoStatement[];
};

export async function getStatusTrackDetails(uids: string[]): Promise<NhsoStatusResult[]> {
  if (uids.length === 0) return [];
  const token = await signOn();
  const hcode = requireEnv("NHSO_CLIENT_ID");

  const res = await fetch(`${getBaseUrl()}/stddataset/api/v2/status-tracks/details`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Request-id": generateRequestId(hcode),
    },
    body: JSON.stringify({ trackDatas: uids.map((uid) => ({ uid })) }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = Array.isArray(data) ? data[0]?.errorDesc : data?.errorDesc;
    throw new Error(message || `NHSO status-tracks/details failed (HTTP ${res.status})`);
  }

  return Array.isArray(data) ? data : [];
}
