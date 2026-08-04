import fs from "fs/promises";

interface ConnectionTarget {
  host: string;
  port: number;
  user: string;
}

/**
 * รหัสผ่านที่เก็บไว้จะถูกเติมให้อัตโนมัติได้เฉพาะเมื่อปลายทางยังเป็น
 * host/port/user เดิมเท่านั้น
 *
 * ถ้าไม่ตรวจข้อนี้ ผู้ที่เปิดหน้าตั้งค่าได้จะพิมพ์ host เป็นเซิร์ฟเวอร์ของตัวเอง
 * แล้วเว้นช่องรหัสผ่านว่างไว้ แอปจะหยิบรหัสผ่าน MySQL ของหน่วยบริการไปเชื่อมต่อ
 * ให้ถึงเครื่องนั้น — เซิร์ฟเวอร์ปลายทางที่เตรียมไว้ดักสามารถขอ plugin
 * mysql_clear_password เพื่ออ่านรหัสผ่านเป็นข้อความธรรมดาได้ทันที
 * เท่ากับดูดรหัสผ่านฐานข้อมูล HOSxP ออกไปโดยไม่ต้องรู้ค่าเดิมเลย
 */
export function canReuseStoredPassword(
  stored: ConnectionTarget | null,
  incoming: ConnectionTarget
): boolean {
  if (!stored) return false;
  return (
    stored.host === incoming.host &&
    stored.port === incoming.port &&
    stored.user === incoming.user
  );
}

/**
 * ไฟล์ตั้งค่าเก็บรหัสผ่านฐานข้อมูลเป็นข้อความธรรมดา จึงต้องให้เฉพาะเจ้าของ
 * process อ่านได้ (0600) ให้เท่ากับที่ lib/session.ts ใช้กับ .session-secret
 *
 * mode ใน writeFile มีผลเฉพาะตอน "สร้างไฟล์ใหม่" — ถ้าไฟล์เดิมมีอยู่แล้วด้วย
 * สิทธิ์ 0644 การเขียนทับจะคงสิทธิ์เดิมไว้ จึงต้อง chmod ซ้ำทุกครั้งเพื่อซ่อม
 * ไฟล์ที่ถูกสร้างไว้ก่อนหน้านี้ด้วย (chmod ไม่มีผลบน Windows จึงกลืน error ทิ้ง)
 */
export async function writeSecretJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}
