import fs from "fs";
import path from "path";

const REPO = "tankitkitty/NDP-Kit";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const ASSET_URL = `https://github.com/${REPO}/releases/latest/download/ndp-kit.zip`;

/**
 * โปรแกรมถูกติดตั้งโดยตัวช่วยติดตั้งไว้แบบนี้
 *   C:\NDPKit\app\      <- cwd ตอนรัน (server.js อยู่ที่นี่)
 *   C:\NDPKit\node\node.exe
 *   C:\NDPKit\start.vbs
 * การอัปเดตในตัวจึงทำได้เฉพาะเมื่อเจอโครงสร้างนี้ครบ ถ้ารันจากซอร์สโค้ดของนักพัฒนา
 * (npm run dev) จะไม่มีไฟล์พวกนี้ ต้องไม่ให้กดอัปเดตได้
 */
export function getInstallRoot(): string | null {
  const root = path.dirname(process.cwd());
  const startVbs = path.join(root, "start.vbs");
  const nodeExe = path.join(root, "node", "node.exe");
  if (fs.existsSync(startVbs) && fs.existsSync(nodeExe)) return root;
  return null;
}

export function isManagedInstall(): boolean {
  return getInstallRoot() !== null;
}

/** "v2.0.1" -> [2, 0, 1] ส่วนที่อ่านเป็นตัวเลขไม่ได้ให้เป็น 0 */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((n) => {
      const parsed = parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

/** true เมื่อ candidate ใหม่กว่า current จริงๆ เท่านั้น */
export function isNewer(candidate: string, current: string): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(LATEST_API, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub ปฏิเสธคำขอที่ไม่มี User-Agent
      "User-Agent": "ndp-kit-updater",
    },
    signal: AbortSignal.timeout(15000),
  });
  // 404 ที่ปลายทางนี้แปลว่ายังไม่มี release เผยแพร่เลย (มีแต่ git tag ซึ่งคนละอย่างกัน)
  // ไม่ใช่ความผิดของเครื่องหน่วยบริการ จึงบอกให้ตรงว่าเกิดอะไรขึ้น
  if (res.status === 404) {
    throw new Error("ยังไม่มีเวอร์ชันเผยแพร่บน GitHub กรุณาแจ้งผู้ดูแลระบบ");
  }
  if (res.status === 403) {
    throw new Error("GitHub จำกัดจำนวนครั้งการเรียกชั่วคราว กรุณาลองใหม่ในอีกสักครู่");
  }
  if (!res.ok) throw new Error(`GitHub ตอบกลับรหัส ${res.status}`);
  const data: any = await res.json();
  const tag = String(data?.tag_name || "").trim();
  if (!tag) throw new Error("ไม่พบเลขเวอร์ชันในข้อมูลที่ GitHub ส่งกลับมา");
  return tag;
}

/**
 * สคริปต์ที่ทำการอัปเดตจริง เขียนเป็น ASCII ล้วนโดยตั้งใจ
 *
 * Windows PowerShell 5.1 อ่านไฟล์ .ps1 ที่ไม่มี BOM เป็นรหัส ANSI ถ้าใส่ภาษาไทย
 * ลงไปแล้วเขียนไฟล์จาก Node (ซึ่งไม่ใส่ BOM ให้) ข้อความจะเพี้ยนทั้งไฟล์
 * ข้อความในนี้จึงเป็นอังกฤษล้วน และมีแต่ตัวเราที่อ่าน (เก็บลง logs\update.log)
 *
 * ลำดับการทำงานออกแบบให้ย้อนกลับได้ถ้าพัง: ดาวน์โหลดให้สำเร็จก่อน แล้วค่อยหยุด
 * โปรแกรม สำรองของเดิมทั้งก้อน ถ้าแตกไฟล์ใหม่ไม่สำเร็จจะเอาของเดิมกลับมาแล้วเปิดต่อ
 */
export function buildUpdateScript(assetUrl: string): string {
  return `# NDP Kit self-update helper. Generated automatically - do not edit.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root    = $PSScriptRoot
$app     = Join-Path $root 'app'
$backup  = Join-Path $root 'app.backup'
$zip     = Join-Path $env:TEMP 'ndp-kit-update.zip'
$dataTmp = Join-Path $env:TEMP 'ndp-kit-data-keep'
$logDir  = Join-Path $root 'logs'
$log     = Join-Path $logDir 'update.log'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
function Log($m) { "\$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  \$m" | Add-Content $log }

Log 'update started'
try {
  Log 'downloading package'
  Invoke-WebRequest '${assetUrl}' -OutFile $zip -UseBasicParsing -TimeoutSec 600
  Log 'download finished'

  # Stop the running app only after the download succeeded, so a network
  # failure never leaves the site down.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  Log 'app stopped'

  if (Test-Path $dataTmp) { Remove-Item $dataTmp -Recurse -Force }
  $dataDir = Join-Path $app 'data'
  if (Test-Path $dataDir) { Copy-Item $dataDir $dataTmp -Recurse -Force; Log 'settings saved' }

  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  Move-Item $app $backup
  Log 'old version moved aside'

  try {
    Expand-Archive -Path $zip -DestinationPath $app -Force
    Log 'new version extracted'
  } catch {
    Log "extract failed: \$(\$_.Exception.Message) - rolling back"
    if (Test-Path $app) { Remove-Item $app -Recurse -Force }
    Move-Item $backup $app
    Start-Process 'wscript.exe' -ArgumentList "\`"\$(Join-Path \$root 'start.vbs')\`"" -WindowStyle Hidden
    Log 'rolled back and restarted'
    exit 1
  }

  if (Test-Path $dataTmp) {
    Copy-Item $dataTmp (Join-Path $app 'data') -Recurse -Force
    Remove-Item $dataTmp -Recurse -Force
    Log 'settings restored'
  }
  Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $zip -Force -ErrorAction SilentlyContinue

  Start-Process 'wscript.exe' -ArgumentList "\`"\$(Join-Path \$root 'start.vbs')\`"" -WindowStyle Hidden
  Log 'app restarted - update complete'
} catch {
  Log "update failed: \$(\$_.Exception.Message)"
  # Last resort: make sure something is running again.
  Start-Process 'wscript.exe' -ArgumentList "\`"\$(Join-Path \$root 'start.vbs')\`"" -WindowStyle Hidden -ErrorAction SilentlyContinue
  exit 1
}
`;
}
