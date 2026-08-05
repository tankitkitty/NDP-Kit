const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * เลขเวอร์ชันที่จะฝังลงหน้าเว็บ (แถบเมนูซ้ายเอาไปแสดงต่อจากชื่อ NDP Kit)
 *
 * ไล่หาจากที่แน่นอนที่สุดก่อน:
 *   1) NEXT_PUBLIC_APP_VERSION — release.yml ตั้งให้จาก git tag ตอน build แพ็กเกจจริง
 *   2) version.txt — ไฟล์ที่อยู่ในแพ็กเกจ เผื่อ build ซ้ำจากโฟลเดอร์ที่แตกไฟล์ไว้แล้ว
 *   3) git describe — ตอนนักพัฒนารันจากซอร์ส จะได้เห็นว่ากำลังรันของเวอร์ชันไหน
 *      ใช้แบบเต็ม (เช่น v2.0.11-8-g1234abc) ไม่ใช่แค่ tag ล่าสุด เพราะซอร์สที่แก้ค้างไว้
 *      ยังไม่ใช่ตัว v2.0.11 จริงๆ ถ้าโชว์แค่ "v2.0.11" จะเข้าใจผิดว่าเป็นของที่ปล่อยแล้ว
 *
 * เดิมมีแค่ข้อ 1 พอรันจากซอร์สเลยไม่โชว์อะไรเลย จนดูไม่ออกว่ากำลังทดสอบโค้ดชุดไหนอยู่
 */
function resolveAppVersion() {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;

  try {
    const txt = fs.readFileSync(path.join(__dirname, "version.txt"), "utf-8").trim();
    if (txt) return txt;
  } catch {
    /* ไม่มีไฟล์ = ไม่ได้รันจากแพ็กเกจ */
  }

  try {
    return execSync("git describe --tags --always --dirty", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    /* ไม่ใช่ git repo หรือไม่มี git = ปล่อยว่าง แถบเมนูจะไม่แสดงเลขเวอร์ชัน */
  }

  return "";
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // "standalone" ทำให้ได้ server.js + node_modules เท่าที่จำเป็น (ประมาณ 20 MB)
  // ใช้เป็นแพ็กเกจที่หน่วยบริการดาวน์โหลดไปรันด้วย node server.js โดยไม่ต้อง npm install
  // เปิดเฉพาะตอน build ใน .github/workflows/release.yml (ตั้ง NEXT_OUTPUT=standalone)
  // เพราะโหมดนี้ใช้กับ npm run start ของนักพัฒนาไม่ได้
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // next dev กับ npm run build ใช้โฟลเดอร์ .next ร่วมกัน — ถ้า build ตอนที่ dev server
  // เปิดค้างอยู่ production build จะล้าง .next ทิ้งแล้วเขียนใหม่ ทำให้ dev server หา
  // ไฟล์ cache ของตัวเองไม่เจอ แล้วพ่น warning ENOENT ...pack.gz รัวๆ
  // ตั้ง NEXT_DIST_DIR=.next-verify ตอนสั่ง build เพื่อตรวจว่าโค้ดผ่าน จะได้ไม่ไปกวน
  // dev server ที่เปิดอยู่ (ตอน release ไม่ต้องตั้ง ให้ใช้ .next ตามปกติ)
  distDir: process.env.NEXT_DIST_DIR || ".next",

  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },

  // ไม่ต้องประกาศให้ใครรู้ว่าเบื้องหลังเป็น Next.js เวอร์ชันไหน
  poweredByHeader: false,

  /**
   * ห้ามให้ไฟล์ในโฟลเดอร์ data/ ติดไปกับแพ็กเกจ standalone เด็ดขาด
   *
   * ในนั้นคือรหัสผ่าน MySQL ของหน่วยบริการ (dbconfig.json) และกุญแจเซ็น session
   * (.session-secret) ถ้าใครสร้างแพ็กเกจจากเครื่องที่เคยตั้งค่าใช้งานจริงแล้วอัปขึ้น
   * GitHub Release ซึ่งเป็นที่สาธารณะ เท่ากับแจกรหัสผ่านฐานข้อมูลให้คนทั้งโลก
   *
   * ปกติ CI สร้างแพ็กเกจจาก checkout ใหม่ที่ไม่มีโฟลเดอร์นี้อยู่แล้ว (ถูก gitignore)
   * แต่กันไว้ตรงนี้ด้วย เพราะพลาดครั้งเดียวก็แก้กลับไม่ได้แล้ว
   */
  outputFileTracingExcludes: {
    "*": ["./data/**"],
  },

  /**
   * หัวข้อความปลอดภัยพื้นฐานของทุกหน้า
   *
   * หน้าจอนี้แสดงข้อมูลผู้ป่วย (ชื่อ HN เลขบัตร) จึงต้องกันไม่ให้เว็บอื่นเอาไป
   * ซ้อนใน iframe เพื่อหลอกให้กดปุ่ม (clickjacking) และกันไม่ให้ที่อยู่ของหน้า
   * รั่วไปกับ referrer เวลาเปิดลิงก์ออกนอก
   *
   * CSP อนุญาต 'unsafe-inline' สำหรับ style เพราะทั้งโปรเจ็คใช้ style ติดใน
   * แท็กอยู่หลายที่ ส่วน script จำกัดไว้ที่ต้นทางเดียวกัน ('unsafe-inline' ของ
   * script จำเป็นสำหรับตัว runtime ของ Next ที่ฝัง JSON ข้อมูลหน้าไว้ในเพจ)
   * ไม่มีการโหลดสคริปต์หรือฟอนต์จากภายนอกเลย (ฟอนต์ self-host อยู่ใน public/)
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
