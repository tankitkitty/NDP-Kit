import { builtinReports } from "./builtin";
import { loadReports } from "./store";
import { ReportDefinition } from "./types";

/**
 * รายงานทั้งหมดที่เครื่องนี้เห็น = ที่ติดมากับโปรแกรม + ที่เขียนเองในเครื่อง
 *
 * แยกไฟล์นี้ออกมาเพื่อไม่ให้ store.ts ต้องรู้จักรายงานติดโปรแกรม ซึ่งจะกลายเป็น
 * การเรียกกันไปมาเป็นวงกลม (builtin/index.ts ใช้ guard.ts ที่ store.ts ก็ใช้)
 *
 * เรียงรายงานติดโปรแกรมไว้บนสุด เพราะเป็นชุดมาตรฐานที่ทุกหน่วยมีเหมือนกัน
 */
export function allReports(): ReportDefinition[] {
  return [...builtinReports(), ...loadReports()];
}

export function findReport(id: string): ReportDefinition | undefined {
  return allReports().find((r) => r.id === id);
}
