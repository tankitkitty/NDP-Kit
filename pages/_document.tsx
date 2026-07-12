import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="th">
      <Head>
        {/* ฟอนต์ Sarabun แบบ self-host (public/fonts) — ไม่พึ่ง Google Fonts
            เพื่อให้แสดงผลถูกต้องแม้เครื่องในหน่วยบริการไม่มีอินเทอร์เน็ต */}
        <link rel="stylesheet" href="/fonts/sarabun.css" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
