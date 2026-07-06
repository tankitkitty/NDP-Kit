import crypto from "crypto";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-insecure-session-secret";
  }
  throw new Error("SESSION_SECRET is not set");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionValue(loginname: string): string {
  const encoded = Buffer.from(loginname, "utf-8").toString("base64url");
  const expires = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${encoded}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined): { loginname: string } | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [encoded, expiresStr, signature] = parts;
  const payload = `${encoded}.${expiresStr}`;
  const expected = sign(payload);

  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  try {
    const loginname = Buffer.from(encoded, "base64url").toString("utf-8");
    return { loginname };
  } catch {
    return null;
  }
}

export function getSession(req: { cookies: Partial<Record<string, string>> }): { loginname: string } | null {
  return verifySessionValue(req.cookies[SESSION_COOKIE_NAME]);
}
