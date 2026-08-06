import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="th">
      <Head>
        {/* ฟอนต์ Sarabun แบบ self-host (public/fonts) — ไม่พึ่ง Google Fonts
            เพื่อให้แสดงผลถูกต้องแม้เครื่องในหน่วยบริการไม่มีอินเทอร์เน็ต */}
        <link rel="stylesheet" href="/fonts/sarabun.css" />
        {/* ไอคอนแท็บเบราว์เซอร์ ใช้แบบเฉพาะไอคอนไม่มีตัวหนังสือ เพราะขนาด 16px
            ตัวหนังสือในโลโก้เต็มจะกลายเป็นรอยเปื้อนอ่านไม่ออก */}
        <link rel="icon" href="/NDP-Kit-mark.png" type="image/png" />
        <link rel="apple-touch-icon" href="/NDP-Kit-mark.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
