# =============================================================================
#  NDP-Kit - ตัวช่วยติดตั้งสำหรับหน่วยบริการ
#
#  เวลาแก้ไฟล์นี้: ต้องบันทึกเป็น UTF-8 พร้อม BOM เสมอ ไม่งั้นภาษาไทยเพี้ยนทั้งไฟล์
#  ส่วน ndp-kit-setup.bat ต้องเป็น ASCII ล้วน ห้ามมีภาษาไทย
# =============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest เร็วขึ้นมากเมื่อไม่วาดแถบ

$APP_NAME     = 'NDP-Kit'
$INSTALL_DIR  = 'C:\NDP-Kit'
# ชื่อโฟลเดอร์เดิม เครื่องที่ติดตั้งไว้ก่อนจะถูกย้ายมาอัตโนมัติ (ดู Move-OldInstall)
$OLD_INSTALL_DIR = 'C:\NDPKit'
# แหล่งไฟล์ติดตั้ง: โฟลเดอร์เวอร์ชันบน Google Drive ของผู้ดูแล
# เลขเวอร์ชันอ่านจากชื่อไฟล์ เช่น ndp-kit-6908070601.zip
$DRIVE_FOLDER_ID = '1DBAV9DkMKxh0O-K_O54XgAd6JfQUYfRq'
$DRIVE_LIST_URL  = "https://drive.google.com/embeddedfolderview?id=$DRIVE_FOLDER_ID"
$APP_ZIP_NAME = 'ndp-kit.zip'
# ไฟล์สำหรับติดตั้งแบบไม่ต่ออินเทอร์เน็ต (เมนู 6) ต้องใช้ชื่อคนละชื่อกับ $APP_ZIP_NAME
$OFFLINE_ZIP_NAME = 'ndp-kit-offline.zip'
$NODE_VER     = 'v24.19.0'
$NODE_ZIP     = "node-$NODE_VER-win-x64.zip"
$NODE_URL     = "https://nodejs.org/dist/$NODE_VER/$NODE_ZIP"
$NODE_SHA_URL = "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt"
$PORTS        = @(3000, 3013, 3113, 3213)
# ห้ามเปลี่ยนชื่อ task ไม่งั้น task เก่าจะค้างอยู่และชี้ไปพาธที่ย้ายไปแล้ว
$TASK_NAME    = 'NDPKit'

$NodeExe   = Join-Path $INSTALL_DIR 'node\node.exe'
$AppDir    = Join-Path $INSTALL_DIR 'app'
$DataDir   = Join-Path $AppDir 'data'
$LogFile   = Join-Path $INSTALL_DIR 'logs\app.log'
$StartCmd  = Join-Path $INSTALL_DIR 'start.cmd'
$StartVbs  = Join-Path $INSTALL_DIR 'start.vbs'

# จำพอร์ตที่ตั้งไว้รอบก่อน เพื่อไม่ให้ URL เปลี่ยนไปมาทุกครั้งที่อัปเดต
$StateFile = Join-Path $env:LOCALAPPDATA 'ndp-kit-setup.json'
$State = @{ port = 0 }
if (Test-Path $StateFile) {
  try {
    $j = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $State.port = [int]$j.port
  } catch {}
}
function Save-State {
  try { [PSCustomObject]$State | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8 } catch {}
}

function Head($text) {
  Clear-Host
  Write-Host ('=' * 62) -ForegroundColor DarkCyan
  Write-Host "   $text" -ForegroundColor Cyan
  Write-Host ('=' * 62) -ForegroundColor DarkCyan
  Write-Host ''
}
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Err($t)  { Write-Host "  [X]  $t" -ForegroundColor Red }
function Step($t) { Write-Host "  $t" }
function Pause-Back {
  Write-Host ''
  Write-Host '  กด Enter เพื่อกลับไปเมนูหลัก' -ForegroundColor DarkGray
  [void](Read-Host)
}

# รหัสสำหรับตั้งค่าครั้งแรก - ตัดตัวอักษรที่อ่านสับสน (I O 0 1) ออก
function New-SetupToken {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 8
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (-join ($bytes | ForEach-Object { $alphabet[$_ % 32] }))
}

# ------------------------------------------------------------------ ดาวน์โหลด
# ไฟล์ที่วางไว้ข้างตัวช่วยติดตั้งมาก่อนเสมอ สำหรับเครื่องที่เน็ตช้าหรือไม่มีเน็ต
function Find-LocalFile($name) {
  # ว่างเมื่อรันแบบ irm ... | iex ซึ่งไม่มีไฟล์อยู่บนดิสก์
  if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { return $null }
  $p = Join-Path $PSScriptRoot $name
  if (Test-Path $p) { return $p }
  return $null
}

function Get-RemoteFile($url, $dest, $label) {
  Step "กำลังดาวน์โหลด$label ..."
  try {
    # กัน proxy ของเครือข่ายคืนไฟล์เก่าที่แคชไว้
    Invoke-WebRequest $url -OutFile $dest -UseBasicParsing -TimeoutSec 600 `
      -Headers @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' }
    return $true
  } catch {
    Err "ดาวน์โหลด$label ไม่สำเร็จ"
    Step "  สาเหตุ: $($_.Exception.Message)"
    return $false
  }
}

# ------------------------------------------------------- รายการเวอร์ชันบน Drive
#
# คืนรายการเรียงจากใหม่ไปเก่า แต่ละตัวมี Tag / FileId / FileName
# ถ้าอ่านไม่ได้ ยังติดตั้งได้ด้วยเมนู 6 เสมอ
function Get-DriveVersions {
  try {
    $html = (Invoke-WebRequest $DRIVE_LIST_URL -UseBasicParsing -TimeoutSec 60 `
      -Headers @{ 'Cache-Control' = 'no-cache' }).Content
  } catch {
    throw "อ่านรายการเวอร์ชันจาก Google Drive ไม่ได้: $($_.Exception.Message)"
  }

  $out = @()
  $re = 'id="entry-([^"]+)"[\s\S]{0,2000}?flip-entry-title[^>]*>([^<]+)<'
  foreach ($m in [regex]::Matches($html, $re)) {
    $id   = $m.Groups[1].Value
    $name = [System.Net.WebUtility]::HtmlDecode($m.Groups[2].Value).Trim()
    if ($name -notmatch '\.zip$') { continue }

    # แบบปัจจุบัน: เลขสิบหลัก = ปีเดือนวันชั่วโมงนาทีที่สร้างแพ็กเกจ
    $dated = [regex]::Match($name, '(?<!\d)(\d{10})(?!\d)')
    if ($dated.Success) {
      $tag  = $dated.Groups[1].Value
      $sort = [int64]$tag
    } else {
      # แบบเก่า x.y.z ยังอ่านได้ ยุบเป็นตัวเลขก้อนเดียวเพื่อให้เรียงข้ามสองรูปแบบได้
      # ค่าสูงสุด 999,999,999 น้อยกว่าเลขแบบเวลาเสมอ = แบบเวลาใหม่กว่าเสมอ
      $v = [regex]::Match($name, '(\d+)\.(\d+)\.(\d+)')
      if (-not $v.Success) { continue }
      $tag  = "v$($v.Groups[1].Value).$($v.Groups[2].Value).$($v.Groups[3].Value)"
      $sort = [int64]$v.Groups[1].Value * 1000000 +
              [int64]$v.Groups[2].Value * 1000 +
              [int64]$v.Groups[3].Value
    }

    $out += [PSCustomObject]@{
      Tag      = $tag
      Sort     = $sort
      FileId   = $id
      FileName = $name
    }
  }

  # เวอร์ชันซ้ำให้เหลือตัวเดียว ไม่งั้นรายการที่ให้ผู้ใช้เลือกจะมีของซ้ำกัน
  return @($out | Sort-Object Sort -Descending | Group-Object Tag | ForEach-Object { $_.Group[0] })
}

# ที่อยู่ดาวน์โหลดผูกกับรหัสไฟล์ ซึ่งไม่ซ้ำกันทุกไฟล์ แคชระหว่างทางจึงคืนไฟล์ผิดตัวไม่ได้
function Get-DriveDownloadUrl($fileId) {
  return "https://drive.google.com/uc?export=download&id=$fileId"
}

# แปลงเลขเวอร์ชันสิบหลักให้คนอ่านออก เช่น 6908060553 -> "6 ส.ค. 69 05:53 น."
# อ่านไม่ออกให้คืนค่าเดิม ไม่ต้องเดา
function Format-VersionText($tag) {
  if ($tag -notmatch '^\d{10}$') { return $tag }
  $months = @('ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.')
  $mm = [int]$tag.Substring(2, 2)
  $dd = [int]$tag.Substring(4, 2)
  if ($mm -lt 1 -or $mm -gt 12 -or $dd -lt 1) { return $tag }
  return "$dd $($months[$mm - 1]) $($tag.Substring(0,2)) $($tag.Substring(6,2)):$($tag.Substring(8,2)) น."
}

# ตรวจว่าไฟล์ Node ที่ได้มาตรงกับค่าที่ nodejs.org ประกาศไว้จริง
# กันไฟล์ถูกแก้ระหว่างทาง หรือดาวน์โหลดมาไม่ครบ
function Test-NodeHash($zipPath) {
  try {
    $sums = (Invoke-WebRequest $NODE_SHA_URL -UseBasicParsing -TimeoutSec 60).Content
  } catch {
    Warn 'ตรวจสอบลายเซ็นไฟล์ Node ไม่ได้ (ต่ออินเทอร์เน็ตไม่ได้) - ข้ามการตรวจ'
    return $true
  }
  $line = ($sums -split "`n" | Where-Object { $_ -match ([regex]::Escape($NODE_ZIP)) } | Select-Object -First 1)
  if (-not $line) { Warn 'ไม่พบค่าลายเซ็นของไฟล์นี้ - ข้ามการตรวจ'; return $true }
  $expected = (($line -split '\s+')[0]).Trim().ToLower()
  $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
  if ($expected -eq $actual) { Ok 'ตรวจลายเซ็นไฟล์ Node ผ่าน'; return $true }
  Err 'ลายเซ็นไฟล์ Node ไม่ตรง - ไฟล์อาจเสียหายหรือถูกแก้ไข'
  Step "  ที่ควรเป็น : $expected"
  Step "  ที่ได้มา   : $actual"
  return $false
}

function Ensure-Node {
  if (Test-Path $NodeExe) {
    $v = & $NodeExe -v 2>$null
    Ok "มี Node อยู่แล้วในโฟลเดอร์โปรแกรม ($v)"
    return $true
  }

  $tmp = Join-Path $env:TEMP $NODE_ZIP
  $local = Find-LocalFile $NODE_ZIP
  if ($local) {
    Ok "พบไฟล์ Node ที่วางไว้ข้างตัวช่วยติดตั้ง - ไม่ต้องดาวน์โหลด"
    Copy-Item $local $tmp -Force
  } else {
    Step "ยังไม่มี Node ในเครื่อง จะดาวน์โหลดรุ่น $NODE_VER (ประมาณ 30 MB)"
    if (-not (Get-RemoteFile $NODE_URL $tmp 'Node.js')) { return $false }
  }

  if (-not (Test-NodeHash $tmp)) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; return $false }

  Step 'กำลังแตกไฟล์ Node ...'
  $stage = Join-Path $env:TEMP 'ndpkit-node-stage'
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  try {
    Expand-Archive -Path $tmp -DestinationPath $stage -Force
    # ใน zip มีโฟลเดอร์ชั้นเดียวชื่อ node-vXX-win-x64 ครอบอยู่ ต้องดึงข้างในออกมา
    $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
    $target = Join-Path $INSTALL_DIR 'node'
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item $inner.FullName $target -Force
  } catch {
    Err "แตกไฟล์ Node ไม่สำเร็จ: $($_.Exception.Message)"
    return $false
  } finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $NodeExe)) { Err 'ติดตั้ง Node ไม่สำเร็จ'; return $false }
  Ok "ติดตั้ง Node $NODE_VER เรียบร้อย (อยู่ในโฟลเดอร์โปรแกรม ไม่ยุ่งกับระบบเดิมของเครื่อง)"
  return $true
}

# ------------------------------------------------------------- จัดการโปรแกรม
function Get-AppProcesses([string]$root = $INSTALL_DIR) {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
  } catch { return @() }
}

function Stop-App([string]$root = $INSTALL_DIR) {
  $procs = Get-AppProcesses $root
  if ($procs.Count -eq 0) { return $false }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  return $true
}

# ย้ายการติดตั้งเดิมจาก C:\NDPKit มาที่ C:\NDP-Kit พร้อมค่าตั้งค่าและ log
# ถ้าไม่ย้าย จะมีสองชุดแย่งพอร์ตกันและค่าตั้งค่าค้างอยู่ที่เก่า
function Move-OldInstall {
  if (-not (Test-Path $OLD_INSTALL_DIR)) { return }

  if (Test-Path $INSTALL_DIR) {
    Warn "พบโฟลเดอร์เก่า $OLD_INSTALL_DIR ค้างอยู่ แต่ $INSTALL_DIR มีอยู่แล้ว"
    Step '  จะใช้โฟลเดอร์ใหม่ต่อไป - ลบโฟลเดอร์เก่าเองได้เมื่อแน่ใจว่าไม่ต้องการแล้ว'
    [void](Stop-App $OLD_INSTALL_DIR)
    return
  }

  Step "พบการติดตั้งเดิมที่ $OLD_INSTALL_DIR - กำลังย้ายมาที่ $INSTALL_DIR"
  [void](Stop-App $OLD_INSTALL_DIR)
  try { $null = schtasks /delete /tn $TASK_NAME /f 2>&1 } catch {}
  try {
    Move-Item $OLD_INSTALL_DIR $INSTALL_DIR -Force
    Ok 'ย้ายเรียบร้อย ค่าตั้งค่าเดิมอยู่ครบ ไม่ต้องตั้งค่าใหม่'
  } catch {
    Err "ย้ายโฟลเดอร์ไม่สำเร็จ: $($_.Exception.Message)"
    Step '  ปิดโปรแกรมที่ใช้ไฟล์ในโฟลเดอร์นั้นอยู่ แล้วลองใหม่อีกครั้ง'
  }
}

function Start-App {
  if (-not (Test-Path $StartVbs)) { return $false }
  Start-Process 'wscript.exe' -ArgumentList "`"$StartVbs`"" -WindowStyle Hidden
  return $true
}

function Test-AppReady([int]$port, [int]$tries = 30) {
  for ($i = 1; $i -le $tries; $i++) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest "http://localhost:$port/login" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
  }
  return $false
}

function Test-PortFree([int]$p) {
  try {
    return ($null -eq (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue))
  } catch {
    $hit = netstat -ano -p TCP | Select-String -SimpleMatch ":$p " | Select-String -SimpleMatch 'LISTENING'
    return ($null -eq $hit)
  }
}

function Get-LanUrls([int]$port) {
  $urls = @()
  try {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      ForEach-Object { $urls += "http://$($_.IPAddress):$port" }
  } catch {}
  return $urls
}

function Get-InstalledVersion {
  $f = Join-Path $AppDir 'version.txt'
  if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
  return ''
}

# อ่านเลขเวอร์ชันจากไฟล์ zip โดยไม่ต้องแตกไฟล์ออกมาก่อน
# ให้ผู้ดูแลเห็นก่อนกดยืนยันว่าไฟล์ในมือเป็นเวอร์ชันอะไร กันเอาของเก่าไปทับของใหม่
function Get-ZipVersion($zipPath) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
      $entry = $archive.GetEntry('version.txt')
      if (-not $entry) { return '' }
      $reader = New-Object System.IO.StreamReader($entry.Open())
      try { return $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
    } finally { $archive.Dispose() }
  } catch {
    return ''
  }
}

# ----------------------------------------------------------------- ติดตั้ง
# $LocalZip ว่าง = โหลดจาก Drive (เมนู 1) มีค่า = ใช้ไฟล์ในเครื่อง (เมนู 6)
# ที่เหลือทำเหมือนกันทุกขั้นตอน
function Invoke-Install {
  param([string]$LocalZip = '')

  Head "ขั้นตอนที่ 1/5 : เตรียม Node.js"
  Move-OldInstall
  if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null }
  if (-not (Ensure-Node)) { Pause-Back; return }

  $zip = Join-Path $env:TEMP $APP_ZIP_NAME

  if ($LocalZip) {
    Head 'ขั้นตอนที่ 2/5 : ใช้ไฟล์โปรแกรมที่เตรียมมา'
    Step "ไฟล์ : $LocalZip"
    $inZip = Get-ZipVersion $LocalZip
    if ($inZip) { Ok "ไฟล์นี้เป็นเวอร์ชัน $inZip  $(Format-VersionText $inZip)" }
    else { Warn 'อ่านเลขเวอร์ชันในไฟล์ไม่ได้ - ไฟล์อาจไม่ใช่แพ็กเกจของ NDP-Kit' }

    $now = Get-InstalledVersion
    if ($now) { Step "เครื่องนี้ติดตั้งไว้ : $now  $(Format-VersionText $now)" }
    Write-Host ''
    if ((Read-Host '  พิมพ์ y แล้ว Enter เพื่อติดตั้งไฟล์นี้') -ne 'y') {
      Warn 'ยกเลิกแล้ว ไม่มีอะไรถูกเปลี่ยน'
      Pause-Back; return
    }
    try {
      Copy-Item $LocalZip $zip -Force
    } catch {
      Err "อ่านไฟล์ไม่สำเร็จ: $($_.Exception.Message)"
      Pause-Back; return
    }
  } else {
    Head 'ขั้นตอนที่ 2/5 : ดาวน์โหลดตัวโปรแกรม'

    # เมนูนี้โหลดใหม่ทุกครั้ง ไม่หยิบไฟล์ที่ค้างในเครื่อง (ใช้ไฟล์ในเครื่อง = เมนู 6)
    $stale = Find-LocalFile $APP_ZIP_NAME
    if ($stale) {
      Warn 'พบไฟล์ ndp-kit.zip เก่าค้างอยู่ข้างตัวช่วยติดตั้ง - ไม่ใช้แล้วและกำลังลบทิ้ง'
      try { Remove-Item $stale -Force; Ok 'ลบไฟล์เก่าเรียบร้อย' } catch { Warn 'ลบไม่สำเร็จ - ลบเองได้ ไฟล์นี้ไม่ถูกใช้แล้ว' }
    }

    # Enter = ตัวใหม่ที่สุด เลือกเองได้เมื่อต้องถอยกลับไปเวอร์ชันก่อนหน้า
    $versions = $null
    try {
      $versions = Get-DriveVersions
    } catch {
      Err $_.Exception.Message
      Step ''
      Step 'ตรวจสอบว่าเครื่องนี้เข้าอินเทอร์เน็ตได้ และเปิด drive.google.com ได้'
      Step 'ถ้าเข้าไม่ได้ ให้ขอไฟล์ติดตั้งจากผู้ดูแลแล้วใช้เมนู 6 แทน'
      Pause-Back; return
    }

    if ($versions.Count -eq 0) {
      Err 'ไม่พบไฟล์เวอร์ชันในโฟลเดอร์ของผู้ดูแล'
      Step '  ไฟล์ต้องเป็น .zip และมีเลขเวอร์ชันในชื่อ เช่น ndp-kit-v2.0.25.zip'
      Step '  แจ้งผู้ดูแลระบบให้ตรวจสอบ'
      Pause-Back; return
    }

    $pick = $versions[0]
    if ($versions.Count -gt 1) {
      Step 'เวอร์ชันที่ติดตั้งได้'
      for ($i = 0; $i -lt $versions.Count; $i++) {
        $mark = if ($i -eq 0) { '  (ใหม่ที่สุด)' } else { '' }
        Write-Host "    [$($i + 1)] $($versions[$i].Tag)   $(Format-VersionText ($versions[$i].Tag))$mark"
      }
      Write-Host ''
      $ans = Read-Host "  เลือกหมายเลข แล้วกด Enter (กด Enter เฉยๆ = $($versions[0].Tag))"
      if ($ans) {
        $n = 0
        if ([int]::TryParse($ans.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $versions.Count) {
          $pick = $versions[$n - 1]
        } else {
          Warn 'หมายเลขไม่ถูกต้อง - จะติดตั้งเวอร์ชันใหม่ที่สุดแทน'
        }
      }
    }
    Step "  จะติดตั้ง $($pick.Tag)  $(Format-VersionText ($pick.Tag))"
    Step "  จากไฟล์ $($pick.FileName)"

    if (-not (Get-RemoteFile (Get-DriveDownloadUrl $pick.FileId) $zip "ตัวโปรแกรม $($pick.Tag)")) {
      Step ''
      Step 'ตรวจสอบว่าเครื่องนี้เข้าอินเทอร์เน็ตได้ และเปิด drive.google.com ได้'
      Step 'แล้วลองใหม่อีกครั้ง'
      Step 'ถ้า Google Drive ใช้ไม่ได้ ให้ขอไฟล์ติดตั้งจากผู้ดูแลแล้วใช้เมนู 6 แทน'
      Pause-Back; return
    }
    Ok "ได้ไฟล์โปรแกรม $($pick.Tag) แล้ว"
  }

  Head 'ขั้นตอนที่ 3/5 : ติดตั้งลงเครื่อง'
  $wasRunning = Stop-App
  if ($wasRunning) { Ok 'ปิดโปรแกรมตัวเดิมที่กำลังทำงานอยู่แล้ว' }

  # ยก app\data ออกมาพักก่อนลบของเก่า ไม่งั้นค่าตั้งค่าหายทุกครั้งที่อัปเดต
  $isFresh = -not (Test-Path (Join-Path $DataDir 'dbconfig.json'))
  $dataBackup = Join-Path $env:TEMP 'ndpkit-data-keep'
  Remove-Item $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $DataDir) {
    Copy-Item $DataDir $dataBackup -Recurse -Force
    Step 'เก็บค่าตั้งค่าเดิมไว้ชั่วคราวแล้ว'
  }

  try {
    # ล้าง app.new ที่ค้าง ไม่งั้น start.cmd จะเอาของเก่ามาทับตัวที่เพิ่งติดตั้ง
    Remove-Item (Join-Path $INSTALL_DIR 'app.new') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $INSTALL_DIR 'app.old') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $INSTALL_DIR 'logs\update-status.txt') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $INSTALL_DIR 'update.ps1') -Force -ErrorAction SilentlyContinue

    Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $AppDir -Force
  } catch {
    Err "แตกไฟล์โปรแกรมไม่สำเร็จ: $($_.Exception.Message)"
    Pause-Back; return
  } finally {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path $dataBackup) {
    Copy-Item $dataBackup $DataDir -Recurse -Force
    Remove-Item $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
    Ok 'คืนค่าตั้งค่าเดิมกลับแล้ว - ไม่ต้องตั้งค่า MySQL ใหม่'
  }
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }

  $ver = Get-InstalledVersion
  if ($ver) {
    Ok "ติดตั้งเวอร์ชัน $ver แล้ว"
  } else {
    Ok 'ติดตั้งไฟล์โปรแกรมแล้ว'
  }

  Head 'ขั้นตอนที่ 4/5 : ตั้งค่าการเริ่มโปรแกรม'
  $port = 0
  foreach ($p in $PORTS) {
    if ((Test-PortFree $p) -or ($State.port -eq $p)) { $port = $p; break }
    Warn "พอร์ต $p ถูกโปรแกรมอื่นใช้อยู่ - ลองพอร์ตถัดไป"
  }
  if ($port -eq 0) { $port = $PORTS[0]; Warn "ไม่พบพอร์ตว่าง จะลองใช้ $port" }
  $State.port = $port
  Save-State
  Ok "จะใช้พอร์ต $port"

  $setupToken = New-SetupToken
  New-Item -ItemType Directory -Path (Join-Path $INSTALL_DIR 'logs') -Force | Out-Null

  # start.cmd ต้องเป็น ASCII ล้วน ห้ามมีภาษาไทย (เหตุผลเดียวกับ .bat)
  $cmd = @"
@echo off
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

rem Apply a staged update before starting node.
rem Files of a running app are locked by Windows, so this is the only safe moment
rem to swap them. The app downloads and extracts the new version into app.new by
rem itself, then restarts; this block does the actual replacement.
if exist "app.new\server.js" (
  echo [%date% %time%] applying staged update>>"logs\update.log"
  if exist "app\data" xcopy /E /I /Y /Q "app\data" "app.new\data" >nul
  if exist "app.old" rmdir /S /Q "app.old"
  if exist "app" move "app" "app.old">nul
  move "app.new" "app">nul
  if exist "app.old" rmdir /S /Q "app.old"
  echo done>"logs\update-status.txt"
  echo [%date% %time%] update applied>>"logs\update.log"
)

cd /d "%~dp0app"
set "PORT=$port"
set "SETUP_TOKEN=$setupToken"
"%~dp0node\node.exe" server.js >> "%~dp0logs\app.log" 2>&1
"@
  Set-Content $StartCmd $cmd -Encoding Ascii

  # เรียกผ่าน wscript เพื่อให้หน้าต่างดำไม่เด้งค้างบนจอผู้ใช้ (พารามิเตอร์ 0 = ซ่อน)
  $vbs = @"
Set sh = CreateObject("WScript.Shell")
base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run """" & base & "start.cmd""", 0, False
"@
  Set-Content $StartVbs $vbs -Encoding Ascii
  Ok 'สร้างไฟล์เริ่มโปรแกรมแล้ว'

  # ให้โปรแกรมเปิดเองทุกครั้งที่ล็อกอินเข้าเครื่อง
  try {
    $null = schtasks /create /tn $TASK_NAME /tr "wscript.exe `"$StartVbs`"" /sc onlogon /f 2>&1
    if ($LASTEXITCODE -eq 0) { Ok 'ตั้งให้เปิดโปรแกรมเองอัตโนมัติทุกครั้งที่เข้าใช้เครื่อง' }
    else { Warn 'ตั้งให้เปิดอัตโนมัติไม่สำเร็จ - เปิดเองได้ที่เมนู 4' }
  } catch { Warn 'ตั้งให้เปิดอัตโนมัติไม่สำเร็จ - เปิดเองได้ที่เมนู 4' }

  # เปิดพอร์ตให้เครื่องอื่นในหน่วยงานเข้าใช้ได้ เฉพาะโปรไฟล์ Private/Domain เท่านั้น
  Step "กำลังเปิดพอร์ต $port ใน Windows Firewall (เฉพาะเครือข่ายในหน่วยงาน) ..."
  try {
    # ลบกฎชื่อเดิมด้วย ไม่งั้นเครื่องที่เคยติดตั้งจะเหลือกฎค้างอยู่
    $null = netsh advfirewall firewall delete rule name="NDP Kit" 2>&1
    $null = netsh advfirewall firewall delete rule name="NDP-Kit" 2>&1
    $null = netsh advfirewall firewall add rule name="NDP-Kit" dir=in action=allow `
      protocol=TCP localport=$port profile=private,domain 2>&1
    if ($LASTEXITCODE -eq 0) { Ok 'เปิดพอร์ตให้เครื่องอื่นในหน่วยงานเข้าใช้ได้แล้ว' }
    else { Warn "เปิดพอร์ตไม่สำเร็จ - เครื่องอื่นอาจเข้าไม่ได้ (เปิดเองได้ที่ Windows Firewall พอร์ต $port)" }
  } catch {
    Warn "เปิดพอร์ตไม่สำเร็จ - เครื่องอื่นอาจเข้าไม่ได้ (เปิดเองได้ที่ Windows Firewall พอร์ต $port)"
  }

  Head 'ขั้นตอนที่ 5/5 : เริ่มโปรแกรม'
  Step 'กำลังเริ่มโปรแกรม ...'
  [void](Start-App)
  if (-not (Test-AppReady $port)) {
    Err 'โปรแกรมยังไม่ตอบสนอง - ดูรายละเอียดที่เมนู 3'
    Pause-Back; return
  }

  Head 'ติดตั้งสำเร็จแล้ว'
  Write-Host "  เปิดใช้งานที่เครื่องนี้ : http://localhost:$port" -ForegroundColor Green
  foreach ($u in (Get-LanUrls $port)) {
    Write-Host "  จากเครื่องอื่นใน LAN    : $u" -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '  ** การเชื่อมต่อเป็น http ธรรมดา ข้อมูลผู้ป่วยและรหัสผ่านจะไม่ถูกเข้ารหัสระหว่างทาง' -ForegroundColor Yellow
  Write-Host '     ให้ใช้เฉพาะในเครือข่ายภายในของหน่วยงานที่เชื่อถือได้ ห้ามเปิดออกอินเทอร์เน็ต' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  สิ่งที่ต้องทำต่อ' -ForegroundColor White
  Step '1. เปิดหน้าเว็บด้านบน แล้วไปเมนู "ตั้งค่าการเชื่อมต่อ"'
  if ($isFresh) {
    Write-Host ''
    Write-Host "     รหัสติดตั้งครั้งแรก : $($setupToken.Substring(0,4))-$($setupToken.Substring(4))" -ForegroundColor Cyan
    Write-Host '     กรอกรหัสนี้ในหน้าตั้งค่า เพื่อยืนยันว่าคุณคือผู้ติดตั้ง' -ForegroundColor DarkGray
    Write-Host '     (กันคนอื่นในวง LAN ชิงตั้งค่าก่อน - ใช้ได้จนกว่าจะบันทึกสำเร็จ)' -ForegroundColor DarkGray
    Write-Host ''
  }
  Step '2. กรอกข้อมูล MySQL ของ HOSxP แล้วกด Save Config และ Test Connection'
  Write-Host '     *** host ใส่ localhost ได้ตามปกติ ถ้า MySQL อยู่เครื่องเดียวกัน ***' -ForegroundColor Yellow
  Step '3. เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่ในระบบ HOSxP'
  Write-Host ''
  Step 'มีเวอร์ชันใหม่เมื่อไร ให้รันไฟล์นี้แล้วเลือกเมนู 1 อีกครั้ง'
  Write-Host ''
  if ((Read-Host '  พิมพ์ y แล้ว Enter เพื่อเปิดหน้าเว็บเลย') -eq 'y') {
    Start-Process "http://localhost:$($State.port)"
  }
  Pause-Back
}

# --------------------------------------------------------------- เมนูอื่น
function Invoke-OpenWeb {
  if ($State.port -eq 0) { Head 'เปิดหน้าเว็บ'; Err 'ยังไม่ได้ติดตั้ง - เลือกเมนู 1 ก่อน'; Pause-Back; return }
  Start-Process "http://localhost:$($State.port)"
}

function Invoke-Status {
  Head 'สถานะและ log'
  $procs = Get-AppProcesses
  if ($procs.Count -gt 0) { Ok "โปรแกรมกำลังทำงาน (process id: $(($procs | ForEach-Object { $_.ProcessId }) -join ', '))" }
  else { Warn 'โปรแกรมไม่ได้ทำงานอยู่' }
  $ver = Get-InstalledVersion
  if ($ver) { Step "เวอร์ชันที่ติดตั้ง : $ver" }
  if ($State.port -gt 0) { Step "พอร์ต             : $($State.port)" }
  Step "โฟลเดอร์          : $INSTALL_DIR"
  Write-Host ''
  if (Test-Path $LogFile) {
    Write-Host '  --- log 30 บรรทัดล่าสุด ---' -ForegroundColor DarkGray
    Get-Content $LogFile -Tail 30 | ForEach-Object { Write-Host "  $_" }
  } else {
    Step 'ยังไม่มีไฟล์ log'
  }
  Pause-Back
}

function Invoke-Toggle {
  Head 'เริ่ม / หยุด โปรแกรม'
  if ((Get-AppProcesses).Count -gt 0) {
    Step 'โปรแกรมกำลังทำงานอยู่ - กำลังหยุด ...'
    [void](Stop-App)
    Ok 'หยุดโปรแกรมแล้ว'
  } else {
    if (-not (Test-Path $StartVbs)) { Err 'ยังไม่ได้ติดตั้ง - เลือกเมนู 1 ก่อน'; Pause-Back; return }
    Step 'กำลังเริ่มโปรแกรม ...'
    [void](Start-App)
    if (Test-AppReady $State.port 15) { Ok "เริ่มแล้ว - http://localhost:$($State.port)" }
    else { Warn 'เริ่มแล้วแต่ยังไม่ตอบสนอง ลองดู log ที่เมนู 3' }
  }
  Pause-Back
}

function Invoke-Uninstall {
  Head 'ถอนการติดตั้ง'
  Step "จะหยุดโปรแกรมและลบโฟลเดอร์ $INSTALL_DIR"
  Write-Host '  *** โฟลเดอร์ data ที่เก็บค่าตั้งค่าจะถูกคัดลอกไปเก็บไว้ที่หน้า Desktop ก่อนลบ ***' -ForegroundColor Yellow
  Write-Host ''
  if ((Read-Host '  พิมพ์ yes แล้ว Enter เพื่อยืนยัน') -ne 'yes') {
    Warn 'ยกเลิกแล้ว ไม่มีอะไรถูกลบ'
    Pause-Back; return
  }
  [void](Stop-App)
  try { $null = schtasks /delete /tn $TASK_NAME /f 2>&1 } catch {}
  if (Test-Path $DataDir) {
    $keep = Join-Path ([Environment]::GetFolderPath('Desktop')) "NDPKit-data-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    try { Copy-Item $DataDir $keep -Recurse -Force; Ok "สำรองค่าตั้งค่าไว้ที่ $keep" } catch { Warn 'สำรองค่าตั้งค่าไม่สำเร็จ' }
  }
  try {
    Remove-Item $INSTALL_DIR -Recurse -Force
    Ok 'ถอนการติดตั้งเรียบร้อย'
  } catch {
    Err "ลบโฟลเดอร์ไม่สำเร็จ: $($_.Exception.Message)"
  }
  Pause-Back
}

# ติดตั้งจากไฟล์ที่ถือมาเอง - สำหรับเครื่องที่ออกอินเทอร์เน็ตไม่ได้
function Invoke-InstallOffline {
  Head 'ติดตั้งจากไฟล์ที่เตรียมมา'
  $file = Find-LocalFile $OFFLINE_ZIP_NAME
  if (-not $file) {
    Warn "ไม่พบไฟล์ $OFFLINE_ZIP_NAME ในโฟลเดอร์เดียวกับตัวช่วยติดตั้ง"
    Step "  วางไฟล์ชื่อ $OFFLINE_ZIP_NAME ไว้ข้างไฟล์นี้ แล้วเลือกเมนู 6 อีกครั้ง"
    Step '  หรือพิมพ์ที่อยู่ไฟล์เต็มๆ ลงไปด้านล่างก็ได้'
    Write-Host ''
    $typed = (Read-Host '  ที่อยู่ไฟล์ (เว้นว่างไว้เพื่อยกเลิก)')
    if ($typed) { $typed = $typed.Trim().Trim('"') }
    if (-not $typed) { Warn 'ยกเลิกแล้ว ไม่มีอะไรถูกเปลี่ยน'; Pause-Back; return }
    if (-not (Test-Path $typed)) { Err 'ไม่พบไฟล์ตามที่อยู่ที่พิมพ์มา'; Pause-Back; return }
    $file = $typed
  }
  Invoke-Install -LocalZip $file
}

# ------------------------------------------------------------------- เมนู
while ($true) {
  Head "$APP_NAME - ตัวช่วยติดตั้ง"
  $ver = Get-InstalledVersion
  if ($ver) { Write-Host "  ติดตั้งไว้แล้ว : $ver  $(Format-VersionText $ver)" -ForegroundColor DarkGray }
  if ((Get-AppProcesses).Count -gt 0 -and $State.port -gt 0) {
    Write-Host "  กำลังทำงานที่  : http://localhost:$($State.port)" -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '  [1] ติดตั้ง หรือ อัปเดตเป็นเวอร์ชันล่าสุด'
  Write-Host '  [2] เปิดหน้าเว็บโปรแกรม'
  Write-Host '  [3] ดูสถานะและ log'
  Write-Host '  [4] เริ่ม / หยุด โปรแกรม'
  Write-Host '  [5] ถอนการติดตั้ง'
  Write-Host '  [6] ติดตั้งจากไฟล์ที่เตรียมมา (ใช้เมื่อโหลดจากอินเทอร์เน็ตไม่ได้)'
  Write-Host '  [0] ออก'
  Write-Host ''
  switch (Read-Host '  เลือกหมายเลข แล้วกด Enter') {
    '1' { Invoke-Install }
    '2' { Invoke-OpenWeb }
    '3' { Invoke-Status }
    '4' { Invoke-Toggle }
    '5' { Invoke-Uninstall }
    '6' { Invoke-InstallOffline }
    '0' { exit 0 }
    default { }
  }
}
