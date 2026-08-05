import AdmZip from "adm-zip";

/**
 * สร้างไฟล์ .xlsx จากตารางเดียว โดยไม่พึ่งไลบรารีอ่าน/เขียน Excel
 *
 * ไฟล์ xlsx คือ zip ที่มี XML ไม่กี่ไฟล์ตามมาตรฐาน OOXML ซึ่งเขียนเองได้ และ
 * โปรเจ็คนี้มี adm-zip ติดมาอยู่แล้ว (ใช้ตอนนำเข้า 43 แฟ้ม) จึงไม่ต้องเพิ่ม
 * dependency ใหม่ให้แพ็กเกจที่หน่วยบริการต้องดาวน์โหลดหนักขึ้น
 *
 * เลือกเขียนเป็น inlineStr ทุกช่องที่เป็นข้อความ แทนการใช้ sharedStrings
 * เพราะไม่ต้องทำตารางคำซ้ำ และที่สำคัญกว่าคือค่าอย่าง HN "0016323" หรือ VN
 * 12 หลักจะคงรูปเดิมไว้ ไม่ถูก Excel ตีเป็นตัวเลขแล้วตัดศูนย์นำหน้าทิ้ง
 */
export interface XlsxColumn {
  key: string;
  label: string;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// สองสไตล์พอ: ปกติ (s=0) กับหัวตารางตัวหนาพื้นเทา (s=1)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // อักขระควบคุมทำให้ Excel ฟ้องว่าไฟล์เสีย ตัดทิ้งก่อนเขียน
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** เลขคอลัมน์ -> ตัวอักษรแบบ Excel (1 -> A, 27 -> AA) */
function colName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cell(ref: string, value: unknown, styleId: number): string {
  const s = styleId ? ` s="${styleId}"` : "";
  // ตัวเลขจริงเท่านั้นที่เขียนเป็นตัวเลข ค่าที่มาเป็นข้อความคงเป็นข้อความเสมอ
  // เพื่อไม่ให้รหัสที่มีศูนย์นำหน้าเพี้ยน
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  const text = value === null || value === undefined ? "" : String(value);
  if (text === "") return `<c r="${ref}"${s}/>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

export function buildXlsx(columns: XlsxColumn[], rows: Record<string, unknown>[]): Buffer {
  const header = columns.map((c, i) => cell(`${colName(i + 1)}1`, c.label, 1)).join("");
  const body = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      const cells = columns.map((c, i) => cell(`${colName(i + 1)}${r}`, row[c.key], 0)).join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");

  // กว้างพอให้อ่านได้โดยไม่ต้องลากขยายเอง แต่ไม่กว้างจนล้นจอ
  const colsXml = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(50, Math.max(12, c.label.length + 6))}" customWidth="1"/>`)
    .join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${colsXml}</cols>
<sheetData><row r="1">${header}</row>${body}</sheetData>
</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="ผลตรวจ" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(CONTENT_TYPES, "utf-8"));
  zip.addFile("_rels/.rels", Buffer.from(ROOT_RELS, "utf-8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbook, "utf-8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(WORKBOOK_RELS, "utf-8"));
  zip.addFile("xl/styles.xml", Buffer.from(STYLES, "utf-8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheet, "utf-8"));
  return zip.toBuffer();
}
