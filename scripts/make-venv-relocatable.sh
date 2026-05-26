#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
VENV_DIR="$BACKEND_DIR/.venv"

if [ ! -f "$VENV_DIR/bin/python" ]; then
    echo "ERROR: .venv not found at $VENV_DIR"
    exit 1
fi

echo "==> Checking if venv is already relocatable"
if otool -L "$VENV_DIR/bin/python" 2>/dev/null | grep -q '@executable_path'; then
    echo "==> Venv is already relocatable, skipping."
    exit 0
fi

HC_PREFIX=$(otool -L "$VENV_DIR/bin/python" 2>/dev/null | grep -oE '/opt/homebrew/Cellar/python[^ ]+' | head -1 || true)
if [ -z "$HC_PREFIX" ]; then
    echo "WARNING: Could not detect Homebrew Python framework path in venv Python binary."
    echo "The venv may already be portable or use a non-Homebrew Python."
    echo "Skipping relocatable fix."
    exit 0
fi

FW_DIR=$(dirname "$HC_PREFIX")
FW_DYLIB="$HC_PREFIX"
FW_APP="$FW_DIR/Resources/Python.app/Contents/MacOS/Python"
FW_PLIST="$FW_DIR/Resources/Info.plist"

if [ ! -f "$FW_DYLIB" ]; then
    echo "ERROR: Python.framework dylib not found at $FW_DYLIB"
    exit 1
fi

echo "==> Found Homebrew Python at $FW_DIR"

cp "$FW_DYLIB" "$VENV_DIR/lib/libpython3.13.dylib"
echo "    Copied framework dylib"

if [ -f "$FW_APP" ]; then
    mkdir -p "$VENV_DIR/lib/Resources/Python.app/Contents/MacOS"
    cp "$FW_APP" "$VENV_DIR/lib/Resources/Python.app/Contents/MacOS/Python"
    echo "    Copied Python.app executable"
fi

if [ -f "$FW_PLIST" ]; then
    cp "$FW_PLIST" "$VENV_DIR/lib/Resources/Info.plist"
    echo "    Copied Info.plist"
fi

fix_bin() {
    local bin="$1"
    local old="$HC_PREFIX"
    local new="@executable_path/../lib/libpython3.13.dylib"
    install_name_tool -change "$old" "$new" "$bin" 2>/dev/null || true
    codesign --sign - --force "$bin" 2>/dev/null || true
}

fix_bin_fw_app() {
    local bin="$1"
    local old="$HC_PREFIX"
    local new="@executable_path/../../../../libpython3.13.dylib"
    install_name_tool -change "$old" "$new" "$bin" 2>/dev/null || true
    codesign --sign - --force "$bin" 2>/dev/null || true
}

echo "==> Fixing install_name for Python binaries"

for bin in python python3 python3.13; do
    if [ -f "$VENV_DIR/bin/$bin" ] && file "$VENV_DIR/bin/$bin" | grep -q 'Mach-O'; then
        fix_bin "$VENV_DIR/bin/$bin"
        echo "    Fixed bin/$bin"
    fi
done

install_name_tool -id @executable_path/../lib/libpython3.13.dylib "$VENV_DIR/lib/libpython3.13.dylib" 2>/dev/null || true
codesign --sign - --force "$VENV_DIR/lib/libpython3.13.dylib" 2>/dev/null || true
echo "    Fixed lib/libpython3.13.dylib id"

if [ -f "$VENV_DIR/lib/Resources/Python.app/Contents/MacOS/Python" ]; then
    fix_bin_fw_app "$VENV_DIR/lib/Resources/Python.app/Contents/MacOS/Python"
    echo "    Fixed Resources/Python.app"
fi

echo "==> Verifying relocatable Python"
if "$VENV_DIR/bin/python" -c "import uvicorn; print('    OK - Python is relocatable')" 2>&1; then
    echo "==> Done."
else
    echo "ERROR: Python verification failed after relocation."
    exit 1
fi
