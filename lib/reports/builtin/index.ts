import { assertSafeSelect } from "../guard";
import { ReportDefinition } from "../types";
import { BuiltinReport } from "./types";
import dailyVisits from "./dailyVisits";

/**
 * ทะเบียนรายงานที่ติดมากับตัวโปรแกรม
 *
 * เพิ่มรายงานใหม่: สร้างไฟล์ในโฟลเดอร์นี้แบบเดียวกับ dailyVisits.ts แล้วเอามาต่อ
 * ท้ายรายการข้างล่าง — ลำดับในรายการคือลำดับที่แสดงในแต่ละหมวด
 *
 * รายงานพวกนี้แก้หรือลบจากหน้าเว็บไม่ได้ ต้องแก้ที่โค้ดแล้วปล่อยเวอร์ชันใหม่
 * ซึ่งเป็นข้อดี เพราะทุกการเปลี่ยนแปลงผ่าน git มีประวัติว่าใครแก้อะไรเมื่อไร
 * และหน่วยบริการทุกแห่งได้ชุดเดียวกันเสมอ ไม่มีใครแก้ query กันเองจนเพี้ยน
 */
const SOURCES: BuiltinReport[] = [dailyVisits];

/** id ของรายงานติดโปรแกรมขึ้นต้นด้วยคำนี้ กันชนกับ uuid ของรายงานที่เขียนเอง */
export const BUILTIN_ID_PREFIX = "builtin:";

export function isBuiltinId(id: string): boolean {
  return typeof id === "string" && id.startsWith(BUILTIN_ID_PREFIX);
}

/**
 * แปลงเป็นรูปแบบเดียวกับรายงานที่ผู้ใช้เขียนเอง เพื่อให้หน้าเว็บและตัวรันใช้ทางเดียวกัน
 *
 * ยังตรวจ SQL ด้วยด่านเดียวกับที่ใช้กับคำสั่งของผู้ใช้ ทั้งที่คำสั่งพวกนี้เราเขียนเอง
 * เพราะด่านนั้นจับคำสั่งที่เขียนพลาดได้ด้วย เช่นเผลอใส่ UPDATE ปนมาตอนก๊อปแปะ
 * ใบที่ไม่ผ่านจะถูกข้ามแทนที่จะทำให้ทั้งหน้าเปิดไม่ได้
 */
function toDefinition(src: BuiltinReport): ReportDefinition | null {
  try {
    assertSafeSelect(src.sql);
  } catch {
    return null;
  }
  return {
    id: `${BUILTIN_ID_PREFIX}${src.id}`,
    name: src.name,
    group: src.group,
    description: src.description,
    sql: src.sql,
    params: src.params,
    author: "มากับโปรแกรม",
    source: "local",
    createdAt: "",
    updatedAt: "",
  };
}

export function builtinReports(): ReportDefinition[] {
  return SOURCES.map(toDefinition).filter((r): r is ReportDefinition => r !== null);
}
