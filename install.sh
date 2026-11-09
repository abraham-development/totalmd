#!/usr/bin/env bash
# Instalador de TotalMD para Ubuntu y derivadas (x86_64).
#
#   curl -fsSL https://raw.githubusercontent.com/abraham-development/totalmd/main/install.sh | bash
#
# Para desinstalar:
#
#   curl -fsSL https://raw.githubusercontent.com/abraham-development/totalmd/main/install.sh | bash -s -- --uninstall
set -euo pipefail

REPO="abraham-development/totalmd"
DEB_URL="https://github.com/$REPO/releases/latest/download/TotalMD_amd64.deb"
PACKAGE="total-md"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Ejecuta un comando como administrador: sudo con terminal, pkexec (ventana de GNOME) sin ella.
as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null && { : </dev/tty; } 2>/dev/null; then
    sudo "$@" </dev/tty
  elif command -v pkexec >/dev/null; then
    pkexec "$@"
  else
    die "se necesitan permisos de administrador y no hay sudo ni pkexec"
  fi
}

[[ "$(uname -s)" == "Linux" ]] || die "TotalMD solo está disponible para Linux"
[[ "$(uname -m)" == "x86_64" ]] || die "TotalMD solo está disponible para x86_64 (tu sistema: $(uname -m))"
command -v apt-get >/dev/null && command -v dpkg >/dev/null \
  || die "este instalador necesita apt y dpkg (Ubuntu, Debian, Linux Mint, Pop!_OS…)"

if [[ "${1:-}" == "--uninstall" ]]; then
  info "Desinstalando TotalMD…"
  as_root apt-get remove -y "$PACKAGE"
  info "TotalMD desinstalada."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DEB="$TMP/TotalMD_amd64.deb"

info "Descargando la última versión de TotalMD…"
if command -v curl >/dev/null; then
  curl -fL --progress-bar -o "$DEB" "$DEB_URL"
elif command -v wget >/dev/null; then
  wget -q --show-progress -O "$DEB" "$DEB_URL"
else
  die "se necesita curl o wget para descargar TotalMD"
fi

VERSION="$(dpkg-deb -f "$DEB" Version 2>/dev/null)" || die "el archivo descargado no es un paquete .deb válido"
# apt lee el paquete con el usuario sin privilegios _apt: el directorio temporal debe ser legible.
chmod 755 "$TMP"
chmod 644 "$DEB"

info "Instalando TotalMD $VERSION (se pedirá tu contraseña)…"
as_root apt-get install -y "$DEB"

info "TotalMD $(dpkg-query -W -f='${Version}' "$PACKAGE") instalada."
echo "    Búscala en «Mostrar aplicaciones». Se actualiza sola cuando hay una versión nueva."
