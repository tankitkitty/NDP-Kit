/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // "standalone" ทำให้ได้ server.js + node_modules เท่าที่จำเป็น (ประมาณ 20 MB)
  // ใช้เป็นแพ็กเกจที่หน่วยบริการดาวน์โหลดไปรันด้วย node server.js โดยไม่ต้อง npm install
  // เปิดเฉพาะตอน build ใน .github/workflows/release.yml (ตั้ง NEXT_OUTPUT=standalone)
  // เพราะโหมดนี้ใช้กับ npm run start ของนักพัฒนาไม่ได้
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

module.exports = nextConfig;
