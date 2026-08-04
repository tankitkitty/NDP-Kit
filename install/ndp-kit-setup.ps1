# =========================================================================
#  NDP Kit - ตัวช่วยติดตั้ง/อัปเดต สำหรับหน่วยบริการ
#  เรียกใช้ผ่าน ndp-kit-setup.bat (ดับเบิลคลิกไฟล์ .bat)
#
#  ไฟล์นี้ต้องบันทึกเป็น UTF-8 **พร้อม BOM** เพราะ Windows PowerShell 5.1
#  จะอ่านไฟล์ที่ไม่มี BOM เป็นรหัส ANSI ทำให้ภาษาไทยเพี้ยนทั้งไฟล์
# =========================================================================
# ห้ามใช้ 'Stop' ที่นี่: Windows PowerShell 5.1 จะห่อ stderr ของโปรแกรมภายนอก
# (docker) เป็น ErrorRecord ทำให้สคริปต์ตายกลางคัน ทั้งที่ docker แค่รายงานสถานะ
# สคริปต์นี้ตรวจผลของ docker จาก exit code เอง จึงใช้ 'Continue'
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

# เรียก docker ผ่าน cmd เสมอ เพื่อให้ stderr ถูกรวมเข้า stdout ตั้งแต่ในระดับ cmd
# PowerShell จึงไม่เห็นมันเป็น error stream (ปัญหาเฉพาะของ PowerShell 5.1)
#
# ต้องส่งข้อความออกทาง Write-Host เท่านั้น ห้ามปล่อยลง output stream
# เพราะ PowerShell คืนค่า "ทุกอย่างที่ฟังก์ชันพ่นออกมา" ไม่ใช่แค่ค่าที่ return
# ถ้าปล่อย log ลง output stream ผู้เรียกจะได้ array แทน exit code แล้วเช็คผิดทั้งหมด
function Invoke-Docker {
  param([string]$Arguments, [switch]$Quiet)
  if ($Quiet) {
    cmd /c "docker $Arguments >nul 2>&1" | Out-Null
  } else {
    cmd /c "docker $Arguments 2>&1" | ForEach-Object { Write-Host $_ }
  }
  return $LASTEXITCODE
}

$IMAGE       = 'ghcr.io/tankitkitty/ndp-kit:latest'
$CNAME       = 'ndp-kit'
$DEFAULT_DIR = 'C:\NDPKit'
$PORTS       = @(3000, 3013, 3113, 3213)

# จำค่าที่ตั้งไว้รอบก่อน เพื่อไม่ต้องถามซ้ำทุกครั้งที่เปิด
$StateFile = Join-Path $env:LOCALAPPDATA 'ndp-kit-setup.json'
$State = @{ dir = ''; port = 0 }
if (Test-Path $StateFile) {
  try {
    $j = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $State.dir = [string]$j.dir
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

# ------------------------------------------------------------------ Docker
function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return 'missing' }
  if ((Invoke-Docker 'info' -Quiet) -eq 0) { return 'ready' }
  return 'stopped'
}

function Ensure-Docker {
  $s = Test-DockerReady
  if ($s -eq 'ready') { Ok 'Docker พร้อมใช้งาน'; return $true }

  if ($s -eq 'missing') {
    Err 'ไม่พบ Docker ในเครื่องนี้'
    Write-Host ''
    Step 'ต้องติดตั้ง Docker Desktop ก่อน แล้วจึงรันไฟล์นี้อีกครั้ง'
    Step 'ดาวน์โหลดที่ https://www.docker.com/products/docker-desktop/'
    Write-Host ''
    if ((Read-Host '  พิมพ์ y แล้ว Enter เพื่อเปิดหน้าดาวน์โหลด') -eq 'y') {
      Start-Process 'https://www.docker.com/products/docker-desktop/'
    }
    return $false
  }

  Warn 'Docker ติดตั้งไว้แล้วแต่ยังไม่ได้เปิด - กำลังเปิด Docker Desktop ให้'
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) { Start-Process $exe } else { Warn 'หา Docker Desktop.exe ไม่เจอ กรุณาเปิดเอง' }
  Step 'รอ Docker พร้อมใช้งาน (ครั้งแรกอาจนาน 1-2 นาที)'
  for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 3
    if ((Test-DockerReady) -eq 'ready') { Ok 'Docker พร้อมใช้งานแล้ว'; return $true }
    if ($i % 5 -eq 0) { Step "   ... รอมาแล้ว $($i * 3) วินาที" }
  }
  Err 'Docker ยังไม่พร้อม กรุณาเปิด Docker Desktop เองแล้วลองใหม่'
  return $false
}

# ------------------------------------------------------------------- พอร์ต
function Test-PortFree([int]$p) {
  try {
    $used = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    return ($null -eq $used)
  } catch {
    # เครื่องที่ไม่มี cmdlet นี้ ให้ถอยไปใช้ netstat
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

# ----------------------------------------------------------------- ติดตั้ง
function Invoke-Install {
  Head 'ขั้นตอนที่ 1/5 : ตรวจสอบ Docker'
  if (-not (Ensure-Docker)) { Pause-Back; return }

  Head 'ขั้นตอนที่ 2/5 : เตรียมที่เก็บโปรแกรม'
  # ไม่ถามผู้ใช้แล้ว - ลงที่ C:\NDPKit เสมอ เพื่อให้ทุกหน่วยบริการอยู่ตำแหน่งเดียวกัน
  # เวลาช่วยแก้ปัญหาทางโทรศัพท์จะได้ไม่ต้องไล่ถามว่าเครื่องนี้ลงไว้ตรงไหน
  #
  # ค่าที่จำไว้รอบก่อนจะใช้ต่อเฉพาะเมื่อเป็นพาธเต็มเท่านั้น เพราะของเดิมเคยเก็บ
  # ค่าอย่าง "." ได้ ทำให้ไฟล์ของโปรแกรมไปกองอยู่ในโฟลเดอร์ที่บังเอิญเปิดอยู่
  # ตอนนั้น แล้วครั้งต่อไปก็ถูกเสนอค่านั้นซ้ำอีก
  $dir = if ($State.dir -and [System.IO.Path]::IsPathRooted($State.dir)) { $State.dir } else { $DEFAULT_DIR }
  Step "ที่เก็บโปรแกรม : $dir"
  try {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  } catch {
    Warn "สร้างโฟลเดอร์ที่ $dir ไม่ได้ - เปลี่ยนไปใช้โฟลเดอร์ผู้ใช้แทน"
    $dir = Join-Path $env:USERPROFILE 'NDPKit'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $State.dir = $dir
  Ok "จะติดตั้งที่ $dir"

  # เคลียร์ตัวเก่าก่อนเลือกพอร์ต ไม่งั้นตัวเก่าที่กำลังจะถูกแทนที่ยังจองพอร์ตอยู่
  # ระบบจะเด้งไปพอร์ตอื่นทั้งที่ไม่จำเป็น ทำให้ผู้ใช้สับสน
  # ปลอดภัย เพราะค่าตั้งค่าทั้งหมดอยู่ในโฟลเดอร์ data ที่อยู่นอก container
  $existing = (cmd /c "docker ps -aq --filter name=^/$CNAME$ 2>nul") -join ''
  if (-not [string]::IsNullOrWhiteSpace($existing)) {
    $oldDir = ''
    try {
      $info = cmd /c "docker inspect $CNAME 2>nul" | ConvertFrom-Json
      $oldDir = [string]$info[0].Config.Labels.'com.docker.compose.project.working_dir'
    } catch {}
    Write-Host ''
    Warn 'พบโปรแกรมที่ติดตั้งไว้ก่อนหน้านี้อยู่แล้วในเครื่อง'
    if ($oldDir) { Step "ตัวเดิมติดตั้งจากโฟลเดอร์ : $oldDir" }
    Step "ตัวใหม่จะติดตั้งที่          : $dir"
    Write-Host ''
    Step 'ถ้าทำต่อ ระบบจะปิดตัวเดิมแล้วใช้ตัวใหม่แทน'
    Write-Host '  (ค่าตั้งค่าในโฟลเดอร์ data ของทั้งสองที่จะไม่ถูกลบ)' -ForegroundColor DarkGray
    Write-Host ''
    if ((Read-Host '  พิมพ์ y แล้ว Enter เพื่อทำต่อ (หรือ Enter เปล่าเพื่อยกเลิก)') -ne 'y') {
      Warn 'ยกเลิกแล้ว ไม่มีอะไรเปลี่ยนแปลง'
      Pause-Back
      return
    }
    $null = Invoke-Docker "rm -f $CNAME" -Quiet
    # Docker คืนพอร์ตช้ากว่าคำสั่ง rm เล็กน้อย ถ้าไปเช็คพอร์ตทันทีจะเห็นว่ายังไม่ว่าง
    # แล้วเด้งไปพอร์ตอื่นทั้งที่ไม่จำเป็น รอสักครู่ให้พอร์ตถูกปล่อยจริงก่อน
    Start-Sleep -Seconds 3
    Ok 'ปิดตัวเดิมเรียบร้อย'
  }

  Head 'ขั้นตอนที่ 3/5 : เลือกพอร์ต'
  $port = 0
  foreach ($p in $PORTS) {
    # พอร์ตที่โปรแกรมเราใช้อยู่เองถือว่าใช้ได้ (กรณีกดอัปเดตซ้ำ)
    if ((Test-PortFree $p) -or ($State.port -eq $p)) { $port = $p; break }
    Warn "พอร์ต $p ถูกโปรแกรมอื่นใช้อยู่ - ลองพอร์ตถัดไป"
  }
  if ($port -eq 0) { $port = $PORTS[0]; Warn "ไม่พบพอร์ตว่าง จะลองใช้ $port" }
  $State.port = $port
  Ok "จะใช้พอร์ต $port"

  Head 'ขั้นตอนที่ 4/5 : เตรียมไฟล์ตั้งค่า'
  $dataDir = Join-Path $dir 'data'
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $compose = @"
# NDP Kit - ไฟล์นี้สร้างอัตโนมัติโดยตัวช่วยติดตั้ง
services:
  ndp-kit:
    image: $IMAGE
    container_name: $CNAME
    restart: unless-stopped
    ports:
      - "`${APP_PORT:-3000}:3000"
    environment:
      - TZ=Asia/Bangkok
    volumes:
      - ./data:/app/data
"@
  Set-Content (Join-Path $dir 'docker-compose.yml') $compose -Encoding UTF8
  Set-Content (Join-Path $dir '.env') "APP_PORT=$port" -Encoding UTF8
  Save-State
  Ok 'สร้าง docker-compose.yml และ .env แล้ว'
  Step 'ค่าตั้งค่าของหน่วยบริการเก็บในโฟลเดอร์ data (อัปเดตกี่ครั้งก็ไม่หาย)'

  Head 'ขั้นตอนที่ 5/5 : ดาวน์โหลดและเริ่มโปรแกรม'
  Step 'กำลังดาวน์โหลดเวอร์ชันล่าสุด (ครั้งแรกอาจใช้เวลาสักครู่)'
  Push-Location $dir
  try {
    if ((Invoke-Docker 'compose pull') -ne 0) {
      Err 'ดาวน์โหลดไม่สำเร็จ - ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'; Pause-Back; return
    }
    if ((Invoke-Docker 'compose up -d') -ne 0) {
      Err 'เริ่มโปรแกรมไม่สำเร็จ - ดูรายละเอียดที่เมนู 3'; Pause-Back; return
    }
  } finally { Pop-Location }

  Write-Host ''
  Step 'กำลังตรวจว่าโปรแกรมพร้อมใช้งาน...'
  $ready = $false
  for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 3
    try {
      $r = Invoke-WebRequest "http://localhost:$port/login" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { Err 'โปรแกรมยังไม่ตอบสนอง - ลองดู log ที่เมนู 3'; Pause-Back; return }

  Head 'ติดตั้งสำเร็จแล้ว'
  Write-Host "  เปิดใช้งานที่เครื่องนี้ : http://localhost:$port" -ForegroundColor Green
  foreach ($u in (Get-LanUrls $port)) {
    Write-Host "  จากเครื่องอื่นใน LAN    : $u" -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '  สิ่งที่ต้องทำต่อ' -ForegroundColor White
  Step '1. เปิดหน้าเว็บด้านบน แล้วไปเมนู "ตั้งค่าการเชื่อมต่อ"'
  Step '2. กรอกข้อมูล MySQL ของ HOSxP แล้วกด Save Config และ Test Connection'
  Write-Host '     *** ถ้า MySQL อยู่เครื่องเดียวกับ Docker ให้ใส่ host เป็น' -ForegroundColor Yellow
  Write-Host '         host.docker.internal แทน localhost ***' -ForegroundColor Yellow
  Step '3. เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่ในระบบ HOSxP'
  Write-Host ''
  Step 'มีเวอร์ชันใหม่เมื่อไร ให้รันไฟล์นี้แล้วเลือกเมนู 1 อีกครั้ง'
  Write-Host ''
  if ((Read-Host '  พิมพ์ y แล้ว Enter เพื่อเปิดหน้าเว็บเลย') -eq 'y') {
    Start-Process "http://localhost:$port"
  }
  Pause-Back
}

# --------------------------------------------------------------- เมนูอื่น
function Invoke-OpenWeb {
  $port = if ($State.port) { $State.port } else { 3000 }
  Start-Process "http://localhost:$port"
}

function Invoke-Status {
  Head 'สถานะโปรแกรม'
  # ใช้รูปแบบตารางมาตรฐานของ docker ไม่ใส่ --format ที่มีเว้นวรรค/ภาษาไทย
  # เพราะต้องส่งผ่าน cmd อีกชั้น เครื่องหมายคำพูดซ้อนจะทำให้ cmd แปลคำสั่งผิด
  $null = Invoke-Docker "ps -a --filter name=$CNAME"
  Write-Host ''
  Write-Host '  --- log 30 บรรทัดล่าสุด ---' -ForegroundColor DarkGray
  # docker logs ส่งบางส่วนออก stderr เป็นปกติ จึงต้องรวมสตรีมตั้งแต่ระดับ cmd
  $null = Invoke-Docker "logs --tail 30 $CNAME"
  Pause-Back
}

function Invoke-Toggle {
  Head 'เริ่ม / หยุด โปรแกรม'
  # -q คืนเฉพาะ container id จึงไม่ต้องใช้ --format ที่มีวงเล็บปีกกา
  $running = (cmd /c "docker ps -q --filter name=$CNAME 2>nul") -join ''
  if (-not [string]::IsNullOrWhiteSpace($running)) {
    Step 'กำลังหยุดโปรแกรม...'
    if ((Invoke-Docker "stop $CNAME" -Quiet) -eq 0) { Ok 'หยุดแล้ว' } else { Err 'หยุดไม่สำเร็จ' }
  } else {
    Step 'กำลังเริ่มโปรแกรม...'
    if ((Invoke-Docker "start $CNAME" -Quiet) -eq 0) { Ok 'เริ่มแล้ว' } else { Err 'เริ่มไม่สำเร็จ - อาจยังไม่ได้ติดตั้ง (เมนู 1)' }
  }
  Pause-Back
}

function Invoke-Uninstall {
  Head 'ถอนการติดตั้ง'
  Step 'จะหยุดและลบโปรแกรมออกจาก Docker'
  Write-Host '  *** โฟลเดอร์ data ที่เก็บค่าตั้งค่าจะไม่ถูกลบ ***' -ForegroundColor Yellow
  Write-Host ''
  if ((Read-Host '  พิมพ์ yes แล้ว Enter เพื่อยืนยัน') -ne 'yes') {
    Warn 'ยกเลิกแล้ว ไม่มีอะไรถูกลบ'
    Pause-Back
    return
  }
  $null = Invoke-Docker "stop $CNAME" -Quiet
  $null = Invoke-Docker "rm $CNAME" -Quiet
  $null = Invoke-Docker "image rm $IMAGE" -Quiet
  Ok 'ลบโปรแกรมออกจาก Docker แล้ว'
  if ($State.dir) {
    Step "ถ้าต้องการลบค่าตั้งค่าด้วย ให้ลบโฟลเดอร์ $(Join-Path $State.dir 'data') เอง"
  }
  Pause-Back
}

# --------------------------------------------------------------- เมนูหลัก
while ($true) {
  Head 'NDP Kit - ตัวช่วยติดตั้ง'
  if ($State.dir)  { Write-Host "  ตำแหน่งติดตั้ง : $($State.dir)"  -ForegroundColor DarkGray }
  if ($State.port) { Write-Host "  พอร์ตที่ใช้     : $($State.port)" -ForegroundColor DarkGray }
  if ($State.dir)  { Write-Host '' }
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
  }
}
