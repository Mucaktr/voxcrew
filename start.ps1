<#
VoxCrew'u elle başlatır (Windows; otomatik başlatma / servis kurulumu YOK).
İlk çalıştırmada backend bağımlılıklarını kilit dosyasından kurar ve arayüzü derler.
macOS / Linux için: ./start.sh   ·   Kurulum rehberi: README.md

  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1           # http://127.0.0.1:7420
  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 -Open     # tarayıcıda aç
  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 -Rebuild  # arayüzü yeniden derle
  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 -Port 7430
  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 -Release  # bu sürümde ek etkisi yok (yönetici/test modu zaten yok)

Betik yolları kendi konumuna göre çözer; hangi klasörden çağrıldığı önemli değildir. Ancak "-File start.ps1" yalnızca
deponun kök klasöründeyken çalışır. Başka bir klasördeysen tam yolu ver:
  powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\voxcrew\start.ps1" -Open

Port verilmezse STUDIO_PORT ortam değişkeni, o da yoksa 7420 kullanılır. Veri dizini STUDIO_DATA_DIR ile değişir.
-Rebuild verilmezse arayüz kendiliğinden yeniden derlenmez; derleme (frontend/dist) kaynaktan eskiyse
açılışta uyarı yazılır ve -Rebuild önerilir. Karar kullanıcınındır.
Gereksinimler: uv (https://docs.astral.sh/uv/), Node 20+ ve npm.

English: starts VoxCrew by hand (Windows; no autostart, no service install). On first run it installs the backend
dependencies from the lock file and builds the UI. Guide: README.md (Quickstart). Use the same commands as above;
"-File start.ps1" only works from the repository root, otherwise pass the full path. The port defaults to the
STUDIO_PORT environment variable, then 7420; the data directory is set with STUDIO_DATA_DIR. Without -Rebuild the UI is
not rebuilt on its own: if frontend/dist is older than the source, a warning is printed at startup and -Rebuild is
suggested. Requirements: uv, Node 20+ and npm.

Mesaj dili / Message language: VOXCREW_LANG=tr (yalnız Türkçe), VOXCREW_LANG=en (English only); ayarlı değilse iki dil
birden (Türkçe satır, ardından İngilizce satır) / unset: both (Turkish line, then English line).
#>
param(
    [int]$Port = 0,
    [switch]$Open,
    [switch]$Rebuild,
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
# F01: -Release = bu sürümde yönetici/test modu zaten yok; bayrak yalnız betik uyumluluğu için duruyor
if ($Release) { $env:VOXCREW_LAUNCH = '1' }
$root = $PSScriptRoot

$voxLang = "$env:VOXCREW_LANG".Trim().ToLowerInvariant()
if ($voxLang -ne 'tr' -and $voxLang -ne 'en') { $voxLang = 'both' }

# HATA / ERROR ile durur: Fail <Türkçe> <English>
function Fail([string]$tr, [string]$en) {
    if ($voxLang -ne 'en') { Write-Host "HATA: $tr" -ForegroundColor Red }
    if ($voxLang -ne 'tr') { Write-Host "ERROR: $en" -ForegroundColor Red }
    exit 1
}

# Betik deponun kök klasöründe değilse (ör. tek başına kopyalandıysa) anlaşılır biçimde dur
if (-not (Test-Path (Join-Path $root 'backend\pyproject.toml')) -or -not (Test-Path (Join-Path $root 'frontend\package.json'))) {
    Fail "start.ps1 VoxCrew deposunun kök klasöründe olmalı (backend ve frontend klasörlerinin yanında). Betiğin bulunduğu yer: $root. Depoyu 'git clone' ile indirip betiği o klasördeki haliyle çalıştır (README.md)." "start.ps1 must be in the root folder of the VoxCrew repository (next to the backend and frontend folders). Script location: $root. Download the repository with 'git clone' and run the script from that folder (README.md, Quickstart)."
}

if ($Port -le 0) {
    $Port = 7420
    if ($env:STUDIO_PORT) { $Port = [int]$env:STUDIO_PORT }
}
if ($Port -lt 1 -or $Port -gt 65535) { Fail "Geçersiz port: $Port (1-65535 arası olmalı)." "Invalid port: $Port (must be between 1 and 65535)." }

function Require-Tool([string]$name, [string]$hintTr, [string]$hintEn) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Fail "Gerekli araç bulunamadı: $name — $hintTr (kurduysan yeni bir terminal aç; PATH ancak öyle yenilenir)" "Required tool not found: $name — $hintEn (if you just installed it, open a new terminal; PATH is only refreshed that way)"
    }
}
Require-Tool 'uv' 'kurulum: https://docs.astral.sh/uv/getting-started/installation/' 'install: https://docs.astral.sh/uv/getting-started/installation/'

# Port boş mu: doluysa uvicorn'un İngilizce hatasına ve yanlış "açıldı" satırına varmadan dur
$probe = $null
try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $probe.Start()
} catch {
    Fail "Port $Port kullanımda (VoxCrew zaten açık olabilir: http://127.0.0.1:$Port). Başka bir port dene: -Port 7430" "Port $Port is in use (VoxCrew may already be running: http://127.0.0.1:$Port). Try another port: -Port 7430"
} finally {
    if ($probe) { $probe.Stop() }
}

$frontend = Join-Path $root 'frontend'
if ($Rebuild -or -not (Test-Path (Join-Path $frontend 'dist\index.html'))) {
    Require-Tool 'node' 'Node.js 20+ kurun: https://nodejs.org/' 'install Node.js 20+: https://nodejs.org/'
    Require-Tool 'npm' 'Node.js 20+ kurun: https://nodejs.org/' 'install Node.js 20+: https://nodejs.org/'
    $nodeMajor = 0
    try { $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]") | Select-Object -First 1) } catch { $nodeMajor = 0 }
    if ($nodeMajor -lt 20) { Fail "Node.js 20 ya da daha yenisi gerekiyor (bulunan ana sürüm: $nodeMajor). https://nodejs.org/" "Node.js 20 or newer is required (found major version: $nodeMajor). https://nodejs.org/" }
    Push-Location $frontend
    try {
        # node_modules yoksa ya da package-lock.json son kurulumdan yeniyse (ör. git pull sonrası) kilit dosyasından kur
        $installed = Join-Path $frontend 'node_modules\.package-lock.json'
        $needCi = -not (Test-Path $installed)
        if (-not $needCi) {
            $needCi = (Get-Item 'package-lock.json').LastWriteTimeUtc -gt (Get-Item $installed).LastWriteTimeUtc
        }
        if ($needCi) {
            npm ci --no-fund --no-audit
            if ($LASTEXITCODE -ne 0) { Fail "npm ci başarısız oldu (çıkış kodu $LASTEXITCODE). İnternet bağlantısını ve Node sürümünü denetle, sonra tekrar dene." "npm ci failed (exit code $LASTEXITCODE). Check your internet connection and Node version, then try again." }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { Fail "Arayüz derlenemedi (npm run build, çıkış kodu $LASTEXITCODE). Yukarıdaki hatayı oku; gerekirse frontend\node_modules klasörünü silip tekrar dene." "The UI could not be built (npm run build, exit code $LASTEXITCODE). Read the error above; if needed delete frontend
ode_modules and try again." }
    } finally { Pop-Location }
}

Push-Location (Join-Path $root 'backend')
$hadChecked = Test-Path Env:STUDIO_BUILD_CHECKED
$code = 0
try {
    uv sync --locked --quiet
    if ($LASTEXITCODE -ne 0) { Fail "Python bağımlılıkları kurulamadı (uv sync --locked, çıkış kodu $LASTEXITCODE). İnternet bağlantısını denetle, sonra tekrar dene." "Python dependencies could not be installed (uv sync --locked, exit code $LASTEXITCODE). Check your internet connection, then try again." }
    if (-not $Rebuild) {
        # STALE-DIST: eski derlemeyi fark et ve -Rebuild öner; kendiliğinden yeniden derleme YOK (kullanıcının kararı)
        $stale = uv run --no-sync python -m studio.buildinfo
        if ($stale) {
            foreach ($line in @($stale)) { Write-Host $line -ForegroundColor Yellow }
            Write-Host "  -> powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Rebuild" -ForegroundColor Yellow
        }
        $env:STUDIO_BUILD_CHECKED = '1'  # sunucu aynı uyarıyı ikinci kez yazmasın
    }
    $cliArgs = @('run', 'voxcrew', '--port', $Port)
    if ($Open) { $cliArgs += '--open' }
    uv @cliArgs
    $code = $LASTEXITCODE
} finally {
    if (-not $hadChecked) { Remove-Item Env:STUDIO_BUILD_CHECKED -ErrorAction SilentlyContinue }
    Pop-Location
}
exit $code
