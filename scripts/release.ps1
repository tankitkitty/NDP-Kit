# =============================================================================
#  NDP-Kit - สร้างแพ็กเกจเวอร์ชันใหม่ (ดู RELEASE.md)
#
#  push tag อย่างเดียวหน่วยบริการไม่เห็นเวอร์ชันใหม่ ต้องเอาไฟล์ขึ้น Drive ด้วย
#  ซึ่งเป็นขั้นที่ทำด้วยมือ สคริปต์จะบอกที่อยู่ไฟล์ให้ตอนจบ
#
#  เวลาแก้ไฟล์นี้: ต้องบันทึกเป็น UTF-8 พร้อม BOM เสมอ ไม่งั้นภาษาไทยเพี้ยนทั้งไฟล์
#
#  วิธีใช้
#    .\scripts\release.ps1                         ใช้เวลาปัจจุบันเป็นเลขเวอร์ชัน
#    .\scripts\release.ps1 -Version 6908070601     กำหนดเลขเวอร์ชันเอง
# =============================================================================

[CmdletBinding()]
param(
  # เว้นว่างไว้ = คำนวณจากเวลาปัจจุบัน ซึ่งเป็นสิ่งที่ต้องการเกือบทุกครั้ง
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Err($t)  { Write-Host "  [X]  $t" -ForegroundColor Red }
function Step($t) { Write-Host "  $t" }
function Head($t) {
  Write-Host ''
  Write-Host ('=' * 62) -ForegroundColor DarkCyan
  Write-Host "   $t" -ForegroundColor Cyan
  Write-Host ('=' * 62) -ForegroundColor DarkCyan
}

# โฟลเดอร์รากของโปรเจ็ค = โฟลเดอร์แม่ของ scripts/
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# ---------------------------------------------------------------- เลขเวอร์ชัน
# รูปแบบ ปปดดววชชนน (พ.ศ. สองหลักท้าย) เช่น 6908070601 = 7 ส.ค. 69 เวลา 06:01
# ต้องตรงกับ lib/version.ts เป๊ะ
function New-VersionNumber {
  $d = Get-Date
  $thaiYear = $d.Year + 543
  return ('{0}{1:d2}{2:d2}{3:d2}{4:d2}' -f `
    (([string]$thaiYear).Substring(2)), $d.Month, $d.Day, $d.Hour, $d.Minute)
}

function Format-VersionText($tag) {
  if ($tag -notmatch '^\d{10}$') { return $tag }
  $months = @('ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.')
  $mm = [int]$tag.Substring(2, 2)
  $dd = [int]$tag.Substring(4, 2)
  if ($mm -lt 1 -or $mm -gt 12 -or $dd -lt 1) { return $tag }
  return "$dd $($months[$mm - 1]) $($tag.Substring(0,2)) $($tag.Substring(6,2)):$($tag.Substring(8,2)) น."
}

if (-not $Version) { $Version = New-VersionNumber }
if ($Version -notmatch '^\d{10}$') {
  Err "เลขเวอร์ชันต้องเป็นตัวเลขสิบหลัก แต่ได้ '$Version'"
  exit 1
}

$ZipName = "ndp-kit-$Version.zip"
$ZipPath = Join-Path $Root $ZipName
$PkgDir  = Join-Path $Root 'package'

Head "ปล่อยเวอร์ชัน $Version  ($(Format-VersionText $Version))"

# ------------------------------------------------------------------ ตรวจก่อน
Head 'ขั้นที่ 1/5 : ตรวจโค้ดก่อนปล่อย'

Step 'ตรวจชนิดข้อมูล (tsc --noEmit) ...'
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Err 'ตรวจชนิดข้อมูลไม่ผ่าน - ยกเลิกการปล่อยเวอร์ชัน'; exit 1 }
Ok 'ตรวจชนิดข้อมูลผ่าน'

Step 'จะตรวจแพ็กเกจอีกครั้งหลังประกอบเสร็จ ก่อนอัปขึ้น Drive'

# ------------------------------------------------------------------- build
Head 'ขั้นที่ 2/5 : build แบบ standalone'

$env:NEXT_OUTPUT = 'standalone'
$env:NEXT_PUBLIC_APP_VERSION = $Version
& npm run build
if ($LASTEXITCODE -ne 0) { Err 'build ไม่ผ่าน - ยกเลิกการปล่อยเวอร์ชัน'; exit 1 }
Ok "build ผ่าน (ฝังเลขเวอร์ชัน $Version ลงในหน้าเว็บแล้ว)"

# --------------------------------------------------------------- ประกอบแพ็กเกจ
Head 'ขั้นที่ 3/5 : ประกอบแพ็กเกจ'

# Next standalone ไม่ก๊อป .next/static กับ public มาให้ ต้องประกอบเอง
if (Test-Path $PkgDir) { Remove-Item -LiteralPath $PkgDir -Recurse -Force }
New-Item -ItemType Directory -Path $PkgDir -Force | Out-Null

Copy-Item (Join-Path $Root '.next\standalone\*') $PkgDir -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $PkgDir '.next') -Force | Out-Null
Copy-Item (Join-Path $Root '.next\static') (Join-Path $PkgDir '.next\static') -Recurse -Force
if (Test-Path (Join-Path $Root 'public')) {
  Copy-Item (Join-Path $Root 'public') (Join-Path $PkgDir 'public') -Recurse -Force
}

# version.txt ต้องไม่มี BOM ไม่งั้นตัวอัปเดตเทียบเลขไม่ตรงแล้วปฏิเสธไฟล์
[System.IO.File]::WriteAllText(
  (Join-Path $PkgDir 'version.txt'), $Version,
  (New-Object System.Text.UTF8Encoding $false))

if (-not (Test-Path (Join-Path $PkgDir 'server.js'))) {
  Err 'ประกอบแพ็กเกจไม่สำเร็จ (ไม่พบ server.js)'; exit 1
}

foreach ($s in @('data\dbconfig.json', 'data\dbconfig43.json', 'data\.session-secret', '.env')) {
  if (Test-Path (Join-Path $PkgDir $s)) {
    Err "แพ็กเกจมีไฟล์ที่ไม่ควรเผยแพร่ ($s) - ยกเลิกทันที"
    exit 1
  }
}
Ok 'ประกอบแพ็กเกจแล้ว ตรวจผ่าน'

# ------------------------------------------------------------------ บีบอัด
Head 'ขั้นที่ 4/5 : บีบอัดและตรวจไฟล์'

# บีบอัดด้วย adm-zip ผ่าน Node — ห้ามใช้ Compress-Archive หรือ
# ZipFile::CreateFromDirectory เด็ดขาด (เหตุผลอยู่ในหัวไฟล์ scripts/pack.js)
# pack.js ตรวจไฟล์ที่เขียนเสร็จให้ด้วย ถ้าไม่ผ่านจะลบไฟล์ทิ้งและคืนค่าล้มเหลว
$packOut = & node (Join-Path $Root 'scripts\pack.js') $PkgDir $ZipPath $Version 2>&1
if ($LASTEXITCODE -ne 0) {
  Err 'บีบอัดหรือตรวจไฟล์ไม่ผ่าน'
  $packOut | ForEach-Object { Step "  $_" }
  exit 1
}

$info = @{}
foreach ($line in $packOut) {
  if ("$line" -match '^(\w+)=(.*)$') { $info[$matches[1]] = $matches[2] }
}
$sizeMb = [double]$info['sizeMb']
Ok "ได้ไฟล์ $ZipName ($sizeMb MB, $($info['entries']) รายการ, version.txt = $($info['version']))"

if ($sizeMb -gt 24) {
  # เกินราว 25 MB แล้ว Drive จะส่งหน้าเว็บกลับมาแทนไฟล์ ทุกหน่วยจะโหลดไม่ได้พร้อมกัน
  Warn "ไฟล์ใหญ่ $sizeMb MB ใกล้เพดาน 25 MB ของ Google Drive แล้ว - ดู RELEASE.md"
}

# --------------------------------------------------------- ขั้นที่เหลือให้คนทำ
Head 'ขั้นที่ 5/5 : เอาไฟล์ขึ้น Google Drive'

Write-Host ''
Warn 'ยังไม่ได้ปล่อยเวอร์ชัน จนกว่าไฟล์จะขึ้น Drive'
Write-Host ''
Step 'ลากไฟล์นี้เข้าโฟลเดอร์เวอร์ชันบน Google Drive'
Write-Host "    $ZipPath" -ForegroundColor Cyan
Write-Host ''
Step 'ข้อควรระวัง'
Step '  - ห้ามเปลี่ยนชื่อไฟล์ ระบบอ่านเลขเวอร์ชันจากชื่อ'
Step '  - ต้องวางที่ชั้นบนสุดของโฟลเดอร์ ไม่ใช่ในโฟลเดอร์ย่อย'
Step '  - รอให้ขึ้นครบ 100% ก่อนแจ้งหน่วยบริการ'
Write-Host ''
Step "เวลาที่สร้าง : $(Format-VersionText $Version)"
Step "ขนาด         : $sizeMb MB"
Write-Host ''
Step 'พออัปเสร็จ หน่วยบริการจะเห็นเมื่อกดปุ่มตรวจสอบเวอร์ชัน หรือเปิดโปรแกรมรอบถัดไป'
Write-Host ''
