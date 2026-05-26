#!/usr/bin/env bash
# Pre-release verification script for desktop packages
# Usage: bash scripts/verify-package.sh [mac|win]
set -euo pipefail

PLATFORM="${1:-mac}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_DIR/desktop"
DIST_DIR="$DESKTOP_DIR/dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass=0
fail=0

check() {
  local label="$1"
  local target="$2"
  if [ -e "$target" ]; then
    echo "  ${GREEN}PASS${NC} $label"
    pass=$((pass + 1))
  else
    echo "  ${RED}FAIL${NC} $label -> $target"
    fail=$((fail + 1))
  fi
}

check_command() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ${GREEN}PASS${NC} $label"
    pass=$((pass + 1))
  else
    echo "  ${RED}FAIL${NC} $label"
    fail=$((fail + 1))
  fi
}

if [ "$PLATFORM" = "mac" ]; then
  APP_DIR=$(find "$DIST_DIR" -name "*.app" -maxdepth 2 -type d | head -1)
  if [ -z "$APP_DIR" ]; then
    echo "${RED}No .app bundle found in $DIST_DIR${NC}"
    exit 1
  fi
  echo "==> Verifying macOS app: $APP_DIR"

  RES="$APP_DIR/Contents/Resources"

  echo ""
  echo "[Critical Resources]"
  check "Python binary"          "$RES/backend/.venv/bin/python"
  check "Entry file"             "$RES/backend/desktop_entry.py"
  check "Backend app/"           "$RES/backend/app/main.py"
  check "Frontend index.html"    "$RES/web/index.html"
  check "Douyin downloader/"     "$RES/douyin-downloader"

  echo ""
  echo "[Dynamic Library Portability]"
  PYTHON_BIN="$RES/backend/.venv/bin/python"
  if [ -f "$PYTHON_BIN" ]; then
    if otool -L "$PYTHON_BIN" 2>/dev/null | grep -q '@executable_path'; then
      echo "  ${GREEN}PASS${NC} Python uses @executable_path (relocatable)"
      pass=$((pass + 1))
    else
      echo "  ${RED}FAIL${NC} Python NOT relocatable — still uses absolute paths"
      fail=$((fail + 1))
    fi
  fi

  echo ""
  echo "[Code Signing]"
  APP_NAME=$(basename "$APP_DIR")
  if codesign -v "$APP_DIR" 2>/dev/null; then
    echo "  ${GREEN}PASS${NC} App bundle signature valid"
    pass=$((pass + 1))
  else
    echo "  ${YELLOW}WARN${NC} App bundle not signed (ad-hoc is OK for local distribution)"
  fi

  echo ""
  echo "[Runtime Test]"
  BACKEND_DIR="$RES/backend"
  if [ -f "$PYTHON_BIN" ]; then
    check_command "Python basic execution" "$PYTHON_BIN" -c "print('ok')"
    check_command "Import uvicorn" "$PYTHON_BIN" -c "import uvicorn"
    if [ -d "$BACKEND_DIR" ]; then
      echo "  $(cd "$BACKEND_DIR" && "$PYTHON_BIN" -c "from app.main import app; print('ok')" 2>&1 | head -1 | grep -q 'ok' && echo "${GREEN}PASS${NC} Import app.main" || echo "${RED}FAIL${NC} Import app.main")"
      pass=$((pass + 1))
    fi
  fi

  echo ""
  echo "[DMG File]"
  DMG_FILE=$(find "$DIST_DIR" -name "*.dmg" -maxdepth 1 | head -1)
  if [ -n "$DMG_FILE" ]; then
    SIZE=$(du -sh "$DMG_FILE" | cut -f1)
    echo "  ${GREEN}PASS${NC} DMG: $DMG_FILE ($SIZE)"
    pass=$((pass + 1))
  else
    echo "  ${RED}FAIL${NC} No DMG file found"
    fail=$((fail + 1))
  fi

elif [ "$PLATFORM" = "win" ]; then
  EXE_FILE=$(find "$DIST_DIR" -name "*.exe" -maxdepth 1 | head -1)
  UNPACKED=$(find "$DIST_DIR" -name "*-unpacked" -maxdepth 1 -type d | head -1)

  if [ -n "$UNPACKED" ]; then
    echo "==> Verifying Windows unpacked: $UNPACKED"
    RES="$UNPACKED/resources"

    echo ""
    echo "[Critical Resources]"
    check "Python binary"          "$RES/backend/.venv/Scripts/python.exe" || check "Python binary (unix)" "$RES/backend/.venv/bin/python"
    check "Entry file"             "$RES/backend/desktop_entry.py"
    check "Backend app/"           "$RES/backend/app/main.py"
    check "Frontend index.html"    "$RES/web/index.html"
  fi

  if [ -n "$EXE_FILE" ]; then
    SIZE=$(du -sh "$EXE_FILE" | cut -f1)
    echo ""
    echo "  ${GREEN}PASS${NC} Installer: $EXE_FILE ($SIZE)"
    pass=$((pass + 1))
  else
    echo "  ${RED}FAIL${NC} No .exe installer found"
    fail=$((fail + 1))
  fi
fi

echo ""
echo "========================================="
if [ $fail -eq 0 ]; then
  echo "${GREEN}All $pass checks passed${NC}"
else
  echo "${RED}$fail check(s) failed, $pass passed${NC}"
  exit 1
fi
