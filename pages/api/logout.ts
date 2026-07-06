import { NextApiRequest, NextApiResponse } from "next";
import { SESSION_COOKIE_NAME } from "../../lib/session";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.status(200).json({ message: "ออกจากระบบสำเร็จ" });
}
