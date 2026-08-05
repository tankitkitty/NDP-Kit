# =============================================================================
#  NDP Kit - ตัวช่วยติดตั้งสำหรับหน่วยบริการ (รันด้วย Node.js ไม่ใช้ Docker)
#
#  ไฟล์นี้ต้องบันทึกเป็น UTF-8 พร้อม BOM เสมอ เพราะ Windows PowerShell 5.1 จะอ่าน
#  ไฟล์ที่ไม่มี BOM เป็นรหัส ANSI แล้วภาษาไทยจะเพี้ยนทั้งไฟล์
#  ส่วน ndp-kit-setup.bat ต้องเป็น ASCII ล้วน ห้ามมีภาษาไทยเด็ดขาด
# =============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest เร็วขึ้นมากเมื่อไม่วาดแถบ

$APP_NAME     = 'NDP Kit'
$INSTALL_DIR  = 'C:\NDP-Kit'
# ชื่อโฟลเดอร์เดิมก่อนเปลี่ยนมาใช้ขีดกลาง เครื่องที่ติดตั้งไว้ก่อนหน้านี้จะถูกย้ายมา
# ให้อัตโนมัติตอนกดเมนู 1 (ดู Move-OldInstall) จะได้ไม่เกิดสองชุดแย่งพอร์ตกัน
$OLD_INSTALL_DIR = 'C:\NDPKit'
$APP_URL      = 'https://github.com/tankitkitty/NDP-Kit/releases/latest/download/ndp-kit.zip'
$APP_ZIP_NAME = 'ndp-kit.zip'
$NODE_VER     = 'v24.19.0'
$NODE_ZIP     = "node-$NODE_VER-win-x64.zip"
$NODE_URL     = "https://nodejs.org/dist/$NODE_VER/$NODE_ZIP"
$NODE_SHA_URL = "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt"
$PORTS        = @(3000, 3013, 3113, 3213)
# คงชื่อ task เดิมไว้แม้โฟลเดอร์จะเปลี่ยนชื่อ เพราะการเปลี่ยนชื่อ task จะทำให้ task
# เก่าค้างอยู่ในเครื่องโดยชี้ไปพาธที่ถูกย้ายไปแล้ว แล้วเด้ง error ทุกครั้งที่ล็อกอิน
# ใช้ชื่อเดิมทำให้ตัวติดตั้งเขียนทับ task เดิมด้วยพาธใหม่ให้เองในขั้นตอนปกติ
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

# รหัสสำหรับตั้งค่าครั้งแรก - กันคนอื่นในวง LAN ชิงเข้าหน้าตั้งค่าก่อนเจ้าหน้าที่
# แล้วชี้ฐานข้อมูลไปเครื่องของตัวเอง (ดู lib/authGuard.ts ฝั่งโปรแกรม)
# ชุดตัวอักษร 32 ตัวนี้ตัด I O 0 1 ออกเพราะผู้ใช้ต้องอ่านจากจอแล้วพิมพ์เอง
# และ 256 หาร 32 ลงตัว การสุ่มด้วย % จึงไม่เอนเอียง
function New-SetupToken {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 8
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (-join ($bytes | ForEach-Object { $alphabet[$_ % 32] }))
}

# ------------------------------------------------------------------ ดาวน์โหลด
# ไฟล์ที่วางไว้ข้างตัวช่วยติดตั้งมาก่อนเสมอ เพื่อให้เครื่องที่เน็ตช้าหรือไม่มีเน็ต
# ติดตั้งได้ โดยผู้ดูแลก๊อปไฟล์ใส่ USB ไปพร้อมกัน
function Find-LocalFile($name) {
  # ว่างได้เมื่อรันแบบบรรทัดเดียว (irm ... | iex) เพราะไม่มีไฟล์อยู่บนดิสก์
  # กรณีนั้นไม่มีไฟล์ข้างๆ ให้หาอยู่แล้ว ข้ามไปดาวน์โหลดตามปกติ
  if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { return $null }
  $p = Join-Path $PSScriptRoot $name
  if (Test-Path $p) { return $p }
  return $null
}

function Get-RemoteFile($url, $dest, $label) {
  Step "กำลังดาวน์โหลด$label ..."
  try {
    # สั่งไม่ให้ใช้ของที่แคชไว้ เพราะเครือข่ายโรงพยาบาลหลายแห่งมี proxy คั่นกลาง
    # ซึ่งอาจคืนไฟล์เวอร์ชันเก่าที่เคยโหลดผ่านมาก่อนแทนตัวล่าสุด
    Invoke-WebRequest $url -OutFile $dest -UseBasicParsing -TimeoutSec 600 `
      -Headers @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' }
    return $true
  } catch {
    Err "ดาวน์โหลด$label ไม่สำเร็จ"
    Step "  สาเหตุ: $($_.Exception.Message)"
    return $false
  }
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

# เดิมโปรแกรมติดตั้งที่ C:\NDPKit ต่อมาเปลี่ยนเป็น C:\NDP-Kit ให้อ่านง่ายขึ้น
# ถ้าปล่อยไว้เฉยๆ ตัวติดตั้งจะสร้างชุดใหม่ขึ้นมาอีกชุด แล้วชุดเก่าที่ยังทำงานอยู่
# จะจองพอร์ตไว้ ทำให้ชุดใหม่เปิดไม่ขึ้น และค่าตั้งค่าเดิมก็ค้างอยู่ที่เก่า
# จึงย้ายทั้งโฟลเดอร์มาให้ ค่าตั้งค่าและ log เดิมตามมาครบ
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

# ----------------------------------------------------------------- ติดตั้ง
function Invoke-Install {
  Head "ขั้นตอนที่ 1/5 : เตรียม Node.js"
  Move-OldInstall
  if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null }
  if (-not (Ensure-Node)) { Pause-Back; return }

  Head 'ขั้นตอนที่ 2/5 : ดาวน์โหลดตัวโปรแกรม'
  $zip = Join-Path $env:TEMP $APP_ZIP_NAME

  # ตัวโปรแกรมดาวน์โหลดใหม่ทุกครั้งเสมอ ไม่รับไฟล์ที่วางไว้ในเครื่องอีกต่อไป
  #
  # เดิมรองรับไว้เพื่อติดตั้งแบบออฟไลน์ แต่กลายเป็นกับดัก เพราะไฟล์เก่าที่ค้างอยู่
  # ข้างตัวช่วยติดตั้งจะถูกหยิบมาใช้ทุกครั้ง เครื่องนั้นจึงติดอยู่กับเวอร์ชันเก่าถาวร
  # โดยไม่มีอะไรบอกผู้ใช้ว่าทำไมกดอัปเดตแล้วไม่ได้ตัวใหม่
  $stale = Find-LocalFile $APP_ZIP_NAME
  if ($stale) {
    Warn 'พบไฟล์ ndp-kit.zip เก่าค้างอยู่ข้างตัวช่วยติดตั้ง - ไม่ใช้แล้วและกำลังลบทิ้ง'
    try { Remove-Item $stale -Force; Ok 'ลบไฟล์เก่าเรียบร้อย' } catch { Warn 'ลบไม่สำเร็จ - ลบเองได้ ไฟล์นี้ไม่ถูกใช้แล้ว' }
  }

  if (-not (Get-RemoteFile $APP_URL $zip 'ตัวโปรแกรมเวอร์ชันล่าสุด')) {
    Step ''
    Step 'ตรวจสอบว่าเครื่องนี้เข้าอินเทอร์เน็ตได้ และเปิดเข้า github.com ได้'
    Step 'แล้วลองใหม่อีกครั้ง'
    Pause-Back; return
  }
  Ok 'ได้ไฟล์โปรแกรมเวอร์ชันล่าสุดแล้ว'

  Head 'ขั้นตอนที่ 3/5 : ติดตั้งลงเครื่อง'
  $wasRunning = Stop-App
  if ($wasRunning) { Ok 'ปิดโปรแกรมตัวเดิมที่กำลังทำงานอยู่แล้ว' }

  # ค่าตั้งค่าของหน่วยบริการอยู่ใน app\data ต้องยกออกมาพักไว้ก่อนลบของเก่า
  # ไม่งั้นอัปเดตทีเดียวค่า MySQL หายหมด ต้องตั้งใหม่ทุกครั้ง
  $isFresh = -not (Test-Path (Join-Path $DataDir 'dbconfig.json'))
  $dataBackup = Join-Path $env:TEMP 'ndpkit-data-keep'
  Remove-Item $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $DataDir) {
    Copy-Item $DataDir $dataBackup -Recurse -Force
    Step 'เก็บค่าตั้งค่าเดิมไว้ชั่วคราวแล้ว'
  }

  try {
    # ล้างของค้างจากการอัปเดตในหน้าเว็บที่ยังสลับไฟล์ไม่เสร็จ ไม่งั้น start.cmd
    # จะเอา app.new เก่ากว่ามาทับตัวที่เพิ่งติดตั้งใหม่ตอนเปิดโปรแกรมครั้งถัดไป
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

  # start.cmd เขียนเป็น ASCII ล้วนด้วยเหตุผลเดียวกับ ndp-kit-setup.bat
  # (cmd.exe อ่านทีละไบต์ตาม code page ภาษาไทยจะทำให้ตัวแยกคำสั่งเลื่อนตำแหน่ง)
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

  # แทนที่ restart: unless-stopped ของ Docker เดิม - ให้เปิดเองทุกครั้งที่ล็อกอิน
  try {
    $null = schtasks /create /tn $TASK_NAME /tr "wscript.exe `"$StartVbs`"" /sc onlogon /f 2>&1
    if ($LASTEXITCODE -eq 0) { Ok 'ตั้งให้เปิดโปรแกรมเองอัตโนมัติทุกครั้งที่เข้าใช้เครื่อง' }
    else { Warn 'ตั้งให้เปิดอัตโนมัติไม่สำเร็จ - เปิดเองได้ที่เมนู 4' }
  } catch { Warn 'ตั้งให้เปิดอัตโนมัติไม่สำเร็จ - เปิดเองได้ที่เมนู 4' }

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

# ------------------------------------------------------------------- เมนู
while ($true) {
  Head "$APP_NAME - ตัวช่วยติดตั้ง"
  $ver = Get-InstalledVersion
  if ($ver) { Write-Host "  ติดตั้งไว้แล้ว : $ver" -ForegroundColor DarkGray }
  if ((Get-AppProcesses).Count -gt 0 -and $State.port -gt 0) {
    Write-Host "  กำลังทำงานที่  : http://localhost:$($State.port)" -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '  [1] ติดตั้ง หรือ อัปเดตเป็นเวอร์ชันล่าสุด'
  Write-Host '  [2] เปิดหน้าเว็บโปรแกรม'
  Write-Host '  [3] ดูสถานะและ log'
  Write-Host '  [4] เริ่ม / หยุด โปรแกรม'
  Write-Host '  [5] ถอนการติดตั้ง'
  Write-Host '  [0] ออก'
  Write-Host ''
  switch (Read-Host '  เลือกหมายเลข แล้วกด Enter') {
    '1' { Invoke-Install }
    '2' { Invoke-OpenWeb }
    '3' { Invoke-Status }
    '4' { Invoke-Toggle }
    '5' { Invoke-Uninstall }
    '0' { exit 0 }
    default { }
  }
}
