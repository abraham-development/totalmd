#!/usr/bin/env bash
# Publica una versión nueva de TotalMD: sube la versión, compila y firma el .deb,
# hace commit + etiqueta, sube el código a GitHub y crea la release con el .deb y
# latest.json. Las apps instaladas la verán al abrirse.
#
# Uso: scripts/publicar.sh 0.2.1 "Qué cambió en esta versión"
set -euo pipefail

REPO="abraham-development/totalmd"
KEY="${TOTALMD_SIGNING_KEY:-$HOME/.tauri/totalmd.key}"

VERSION="${1:-}"
NOTES="${2:-}"
die() { echo "Error: $*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "uso: $0 X.Y.Z \"notas\""
[[ -n "$NOTES" ]] || die "escribe las notas de la versión entre comillas"
[[ -f "$KEY" ]] || die "no existe la clave de firma $KEY"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

[[ "$(git branch --show-current)" == "main" ]] || die "publica desde la rama main"
[[ -z "$(git status --porcelain)" ]] || die "hay cambios sin commit; haz commit primero"
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && die "la etiqueta v$VERSION ya existe"

CURRENT="$(node -p "require('./package.json').version")"
[[ "$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)" == "$VERSION" && "$CURRENT" != "$VERSION" ]] \
  || die "la versión nueva ($VERSION) debe ser mayor que la actual ($CURRENT)"

echo "==> Versión $CURRENT → $VERSION"
node -e '
  const fs = require("fs"), v = process.argv[1];
  for (const f of ["package.json", "src-tauri/tauri.conf.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  }' "$VERSION"
sed -i "0,/^version = \".*\"/s//version = \"$VERSION\"/" src-tauri/Cargo.toml

echo "==> Compilando y firmando"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build --bundles deb

BUNDLE="src-tauri/target/release/bundle/deb"
DEB="$BUNDLE/TotalMD_${VERSION}_amd64.deb"
[[ -f "$DEB" && -f "$DEB.sig" ]] || die "no se generó $DEB o su firma"

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp "$DEB" "$OUT/"
cp "$DEB" "$OUT/TotalMD_amd64.deb" # enlace estable para la primera instalación
URL="https://github.com/$REPO/releases/download/v$VERSION/TotalMD_${VERSION}_amd64.deb"
node -e '
  const fs = require("fs"), [v, notes, sig, url, out] = process.argv.slice(1);
  const entry = { signature: fs.readFileSync(sig, "utf8").trim(), url };
  fs.writeFileSync(out, JSON.stringify({
    version: v, notes, pub_date: new Date().toISOString(),
    platforms: { "linux-x86_64-deb": entry, "linux-x86_64": entry },
  }, null, 2) + "\n");' "$VERSION" "$NOTES" "$DEB.sig" "$URL" "$OUT/latest.json"

echo "==> Commit, etiqueta y push a $REPO"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "Versión $VERSION" -m "$NOTES"
git tag -a "v$VERSION" -m "TotalMD $VERSION"
git push -q --follow-tags origin main

echo "==> Release en $REPO"
gh release create "v$VERSION" --repo "$REPO" --title "TotalMD $VERSION" --notes "$NOTES" \
  "$OUT/TotalMD_${VERSION}_amd64.deb" "$OUT/TotalMD_amd64.deb" "$OUT/latest.json"

echo
echo "Listo: TotalMD $VERSION publicada."
echo "Las apps instaladas mostrarán el aviso de actualización al abrirse."
