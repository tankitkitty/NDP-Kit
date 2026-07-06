import { NextApiRequest, NextApiResponse } from "next";
import { initializeDatabase, query } from "../../lib/db";
import { getSession } from "../../lib/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getSession(req)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  if (req.method === "GET") {
    try {
      await initializeDatabase();
      const items = await query("SELECT * FROM items ORDER BY id DESC");
      return res.status(200).json({ items });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถโหลดข้อมูลได้" });
    }
  }

  if (req.method === "POST") {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description : "";

    if (!name) {
      return res.status(400).json({ error: "กรุณาระบุชื่อ" });
    }

    try {
      const result: any = await query("INSERT INTO items (name, description) VALUES (?, ?)", [name, description]);
      const itemRows: any = await query("SELECT * FROM items WHERE id = ?", [result.insertId]);
      return res.status(201).json({ item: itemRows[0] });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถเพิ่มข้อมูลได้" });
    }
  }

  if (req.method === "PUT") {
    const id = Number(req.body?.id);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description : "";

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "id ไม่ถูกต้อง" });
    }
    if (!name) {
      return res.status(400).json({ error: "กรุณาระบุชื่อ" });
    }

    try {
      await query("UPDATE items SET name = ?, description = ? WHERE id = ?", [name, description, id]);
      const updatedRows: any = await query("SELECT * FROM items WHERE id = ?", [id]);
      if (!updatedRows[0]) {
        return res.status(404).json({ error: "ไม่พบข้อมูลที่ต้องการแก้ไข" });
      }
      return res.status(200).json({ item: updatedRows[0] });
    } catch (error) {
      return res.status(500).json({ error: "ไม่สามารถอัปเดตข้อมูลได้" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT"]);
  res.status(405).end("Method Not Allowed");
}
