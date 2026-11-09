#!/usr/bin/env bash
# Instala TotalMD solo para el usuario actual (sin sudo) en ~/.local.
# Uso: scripts/install-local.sh            → compila e instala
#      scripts/install-local.sh --uninstall → desinstala
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN="$HOME/.local/bin"
APP_ID="dev.totalmd.TotalMD"
DESKTOP="$DATA/applications/$APP_ID.desktop"

refresh() {
  update-mime-database "$DATA/mime" >/dev/null 2>&1 || true
  update-desktop-database -q "$DATA/applications" 2>/dev/null || true
  gtk-update-icon-cache -q -t -f "$DATA/icons/hicolor" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN/totalmd" "$DESKTOP" "$DATA/mime/packages/totalmd.xml"
  find "$DATA/icons/hicolor" -name 'totalmd.*' -delete 2>/dev/null || true
  refresh
  echo "TotalMD desinstalado."
  exit 0
fi

cd "$ROOT"
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle

install -Dm755 src-tauri/target/release/totalmd "$BIN/totalmd"
install -Dm644 src-tauri/linux/totalmd-mime.xml "$DATA/mime/packages/totalmd.xml"
install -Dm644 src-tauri/icons/icon.svg "$DATA/icons/hicolor/scalable/apps/totalmd.svg"
install -Dm644 src-tauri/icons/32x32.png "$DATA/icons/hicolor/32x32/apps/totalmd.png"
install -Dm644 src-tauri/icons/128x128.png "$DATA/icons/hicolor/128x128/apps/totalmd.png"
install -Dm644 src-tauri/icons/128x128@2x.png "$DATA/icons/hicolor/256x256/apps/totalmd.png"
install -Dm644 src-tauri/icons/icon.png "$DATA/icons/hicolor/512x512/apps/totalmd.png"

mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Version=1.5
Name=TotalMD
GenericName=Markdown Editor
GenericName[es]=Editor de Markdown
Comment=Markdown viewer and editor with Mermaid diagrams
Comment[es]=Visor y editor de Markdown con diagramas Mermaid
Exec=$BIN/totalmd %F
TryExec=$BIN/totalmd
Icon=totalmd
Terminal=false
StartupNotify=true
StartupWMClass=totalmd
Categories=Utility;TextEditor;
Keywords=markdown;md;mermaid;mmd;diagram;editor;viewer;diagrama;
MimeType=text/markdown;text/x-markdown;text/x-mermaid;
DESK

refresh
echo "TotalMD instalado en $BIN/totalmd — búscalo en «Mostrar aplicaciones»."
