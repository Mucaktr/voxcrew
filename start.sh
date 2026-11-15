#!/usr/bin/env sh
# VoxCrew'u elle başlatır (macOS / Linux). Otomatik başlatma ya da servis kurulumu YOK.
# Starts VoxCrew by hand (macOS / Linux). No autostart, no service install.
# İlk çalıştırmada backend bağımlılıklarını kilit dosyasından kurar ve arayüzü derler.
# On first run it installs the backend dependencies from the lock file and builds the UI.
#
#   sh ./start.sh              # http://127.0.0.1:7420  (port: STUDIO_PORT ya da --port / or --port)
#   sh ./start.sh --open       # tarayıcıda aç / open in the browser
#   sh ./start.sh --rebuild    # arayüzü yeniden derle / rebuild the UI
#   sh ./start.sh --port 7430
#   sh ./start.sh --release    # no extra effect in this edition (there is no admin/test mode) / bu sürümde ek etkisi yok
#   sh ~/voxcrew/start.sh      # başka bir klasörden / from another folder: paths resolve from the script's own location
#
# --rebuild verilmezse arayüz kendiliğinden yeniden derlenmez; derleme (frontend/dist) kaynaktan eskiyse açılışta
# uyarı yazılır ve --rebuild önerilir. Veri dizini STUDIO_DATA_DIR ile değişir. Rehber: README.md
# Without --rebuild the UI is not rebuilt on its own; if frontend/dist is older than the source a warning is printed
# at startup. The data directory is set with STUDIO_DATA_DIR. Guide: README.md (Quickstart).
# Gereksinimler / Requirements: uv (https://docs.astral.sh/uv/), Node 20+ ve/and npm.
#
# Mesaj dili / Message language: VOXCREW_LANG=tr (yalnız Türkçe), VOXCREW_LANG=en (English only); ayarlı değilse iki dil
# birden (Türkçe satır, ardından İngilizce satır) / unset: both languages (Turkish line, then English line).
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT="${STUDIO_PORT:-7420}"
OPEN=0
REBUILD=0

case "${VOXCREW_LANG:-}" in
  tr|TR) LANG_MODE=tr ;;
  en|EN) LANG_MODE=en ;;
  *) LANG_MODE=both ;;
esac

# stderr'e iki dilli ileti: say <Türkçe> <English>
say() {
  case "$LANG_MODE" in
    tr) echo "$1" >&2 ;;
    en) echo "$2" >&2 ;;
    *) echo "$1" >&2; echo "$2" >&2 ;;
  esac
}

# HATA / ERROR ile durur: fail <Türkçe> <English>
fail() {
  case "$LANG_MODE" in
    tr) echo "HATA: $1" >&2 ;;
    en) echo "ERROR: $2" >&2 ;;
    *) echo "HATA: $1" >&2; echo "ERROR: $2" >&2 ;;
  esac
  exit 1
}

usage() {
  case "$LANG_MODE" in
    tr|both)
      cat <<'EOT'
VoxCrew'u başlatır (macOS / Linux).
  sh ./start.sh              http://127.0.0.1:7420 (port: STUDIO_PORT ya da --port)
  sh ./start.sh --open       tarayıcıda aç
  sh ./start.sh --rebuild    arayüzü yeniden derle
  sh ./start.sh --port 7430
Veri dizini STUDIO_DATA_DIR ile değişir. Mesaj dili: VOXCREW_LANG=tr|en. Rehber: README.md
EOT
      ;;
  esac
  case "$LANG_MODE" in
    en|both)
      cat <<'EOT'
Starts VoxCrew (macOS / Linux).
  sh ./start.sh              http://127.0.0.1:7420 (port: STUDIO_PORT or --port)
  sh ./start.sh --open       open in the browser
  sh ./start.sh --rebuild    rebuild the UI
  sh ./start.sh --port 7430
The data directory is set with STUDIO_DATA_DIR. Message language: VOXCREW_LANG=tr|en. Guide: README.md (Quickstart)
EOT
      ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --open) OPEN=1 ;;
    --rebuild) REBUILD=1 ;;
    # F01: bu sürümde yönetici/test modu zaten yok; bayrak yalnız betik uyumluluğu için duruyor
    --release) VOXCREW_LAUNCH=1; export VOXCREW_LAUNCH ;;
    --port)
      shift
      [ $# -gt 0 ] || { say "--port bir değer ister" "--port needs a value"; exit 2; }
      PORT="$1" ;;
    --port=*) PORT="${1#--port=}" ;;
    -h|--help)
      usage
      exit 0 ;;
    *) say "Bilinmeyen seçenek: $1" "Unknown option: $1"; exit 2 ;;
  esac
  shift
done

# Betik deponun kök klasöründe değilse (ör. tek başına kopyalandıysa) anlaşılır biçimde dur
if [ ! -f "$ROOT/backend/pyproject.toml" ] || [ ! -f "$ROOT/frontend/package.json" ]; then
  fail "start.sh VoxCrew deposunun kök klasöründe olmalı (backend ve frontend klasörlerinin yanında). Betiğin bulunduğu yer: $ROOT. Depoyu 'git clone' ile indirip betiği o klasördeki haliyle çalıştır (README.md)." \
       "start.sh must be in the root folder of the VoxCrew repository (next to the backend and frontend folders). Script location: $ROOT. Download the repository with 'git clone' and run the script from that folder (README.md, Quickstart)."
fi
case "$PORT" in
  ''|*[!0-9]*) fail "Geçersiz port: $PORT (1-65535 arası bir sayı olmalı)." "Invalid port: $PORT (must be a number between 1 and 65535)." ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "Geçersiz port: $PORT (1-65535 arası olmalı)." "Invalid port: $PORT (must be between 1 and 65535)."

# need <araç> <Türkçe ipucu> <English hint>
need() {
  command -v "$1" >/dev/null 2>&1 || fail "Gerekli araç bulunamadı: $1 — $2 (kurduysan yeni bir terminal aç; PATH ancak öyle yenilenir)" \
    "Required tool not found: $1 — $3 (if you just installed it, open a new terminal; PATH is only refreshed that way)"
}
need uv "kurulum: https://docs.astral.sh/uv/getting-started/installation/" "install: https://docs.astral.sh/uv/getting-started/installation/"

if [ "$REBUILD" -eq 1 ] || [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  need node "Node.js 20+ kurun: https://nodejs.org/" "install Node.js 20+: https://nodejs.org/"
  need npm "Node.js 20+ kurun: https://nodejs.org/" "install Node.js 20+: https://nodejs.org/"
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || fail "Node.js 20 ya da daha yenisi gerekiyor (bulunan ana sürüm: $NODE_MAJOR). Dağıtımının paketi eskiyse https://nodejs.org/ adresindeki kurulumu kullan." \
    "Node.js 20 or newer is required (found major version: $NODE_MAJOR). If your distribution's package is older, use the installer from https://nodejs.org/."
  (
    cd "$ROOT/frontend"
    # node_modules yoksa ya da package-lock.json son kurulumdan yeniyse (ör. git pull sonrası) kilit dosyasından kur
    if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
      npm ci --no-fund --no-audit || fail "npm ci başarısız oldu. İnternet bağlantısını ve Node sürümünü denetle, sonra tekrar dene." \
        "npm ci failed. Check your internet connection and Node version, then try again."
    fi
    npm run build || fail "Arayüz derlenemedi (npm run build). Yukarıdaki hatayı oku; gerekirse frontend/node_modules klasörünü silip tekrar dene." \
      "The UI could not be built (npm run build). Read the error above; if needed delete frontend/node_modules and try again."
  ) || exit 1
fi

cd "$ROOT/backend"
uv sync --locked --quiet || fail "Python bağımlılıkları kurulamadı (uv sync --locked). İnternet bağlantısını denetle, sonra tekrar dene." \
  "Python dependencies could not be installed (uv sync --locked). Check your internet connection, then try again."
# Port boş mu: doluysa uvicorn'un İngilizce hatasına ve yanlış "açıldı" satırına varmadan dur
if ! uv run --no-sync python -c "
import socket, sys
s = socket.socket()
if sys.platform != 'win32':
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('127.0.0.1', int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
" "$PORT"; then
  fail "Port $PORT kullanımda (VoxCrew zaten açık olabilir: http://127.0.0.1:$PORT). Başka bir port dene: --port 7430" \
    "Port $PORT is in use (VoxCrew may already be running: http://127.0.0.1:$PORT). Try another port: --port 7430"
fi
if [ "$REBUILD" -eq 0 ]; then
  # STALE-DIST: eski derlemeyi fark et ve --rebuild öner; kendiliğinden yeniden derleme YOK (kullanıcının kararı)
  # (uyarı metni backend/studio/buildinfo.py'den gelir ve zaten iki dillidir / the text comes from buildinfo.py, already bilingual)
  STALE_MSG=$(uv run --no-sync python -m studio.buildinfo || true)
  if [ -n "$STALE_MSG" ]; then
    printf '%s\n  -> sh "%s/start.sh" --rebuild\n' "$STALE_MSG" "$ROOT" >&2
  fi
  STUDIO_BUILD_CHECKED=1  # sunucu aynı uyarıyı ikinci kez yazmasın
  export STUDIO_BUILD_CHECKED
fi
if [ "$OPEN" -eq 1 ]; then
  exec uv run voxcrew --port "$PORT" --open
fi
exec uv run voxcrew --port "$PORT"
