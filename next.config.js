/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // "standalone" ทำให้ได้ server.js + node_modules เท่าที่จำเป็น สำหรับใส่ใน Docker image
  // เปิดเฉพาะตอน build ใน Dockerfile (ตั้ง NEXT_OUTPUT=standalone) เพื่อไม่กระทบ
  // การรันแบบเดิม (npm run build + npm run start) ของหน่วยที่ไม่ใช้ Docker
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

module.exports = nextConfig;
