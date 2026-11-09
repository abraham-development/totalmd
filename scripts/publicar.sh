#!/usr/bin/env bash
# Publica una versión nueva de TotalMD:
#   1. sube la versión, compila y firma el .deb;
#   2. hace commit + etiqueta y sube el código a GitHub;
#   3. crea la release con el .deb;
#   4. comprueba que GitHub ya sirve el .deb y solo entonces la ANUNCIA
#      (latest.json en el repo y en la release): las apps instaladas la verán al abrirse.
#
# Uso:  scripts/publicar.sh 0.2.1 "Qué cambió en esta versión"
#       scripts/publicar.sh --anunciar 0.2.1   # repite solo el paso 4 si GitHub tardó demasiado
set -euo pipefail

REPO="abraham-development/totalmd"
KEY="${TOTALMD_SIGNING_KEY:-$HOME/.tauri/totalmd.key}"
BUNDLE="src-tauri/target/release/bundle/deb"

die() { echo "Error: $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

# Devuelve 0 si la URL se puede descargar (pide solo el primer byte).
downloadable() {
  local code
  code="$(curl -sL -r 0-0 -o /dev/null -w '%{http_code}' "$1" || true)"
  [[ "$code" == "200" || "$code" == "206" ]]
}

# Paso 4: espera a que GitHub sirva el .deb (GitHub a veces devuelve 504 durante un
# rato con un asset recién subido; su copia con otro nombre suele funcionar) y publica
# latest.json apuntando a la URL que funciona.
announce() {
  local version="$1" notes="$2"
  local deb="$BUNDLE/TotalMD_${version}_amd64.deb"
  [[ -f "$deb.sig" ]] || die "no está la firma $deb.sig (¿se compiló $version en esta PC?)"
  local base="https://github.com/$REPO/releases/download/v$version"
  local url="" round
  echo "==> Comprobando que GitHub sirve el .deb"
  for round in $(seq 1 20); do
    for name in "TotalMD_${version}_amd64.deb" "TotalMD_amd64.deb"; do
      if downloadable "$base/$name"; then url="$base/$name"; break 2; fi
    done
    echo "    GitHub aún no sirve el .deb (intento $round/20); reintento en 15 s…"
    sleep 15
  done
  [[ -n "$url" ]] || die "GitHub no sirve el .deb todavía. Cuando funcione, ejecuta: $0 --anunciar $version"
  echo "    OK: $url"

  local tmp
  tmp="$(mktemp -d)"
  node -e '
    const fs = require("fs"), [v, notes, sig, url, out] = process.argv.slice(1);
    const entry = { signature: fs.readFileSync(sig, "utf8").trim(), url };
    fs.writeFileSync(out, JSON.stringify({
      version: v, notes, pub_date: new Date().toISOString(),
      platforms: { "linux-x86_64-deb": entry, "linux-x86_64": entry },
    }, null, 2) + "\n");' "$version" "$notes" "$deb.sig" "$url" "$tmp/latest.json"

  echo "==> Anunciando $version"
  # La app lee primero la copia del repo (raw.githubusercontent.com), más fiable que
  # los assets .json de las releases; la de la release queda como respaldo.
  mkdir -p updates
  cp "$tmp/latest.json" updates/latest.json
  git add updates/latest.json
  git commit -q -m "Anunciar versión $version" -m "$notes"
  git push -q origin main
  gh release upload "v$version" "$tmp/latest.json" --repo "$REPO" --clobber
  rm -rf "$tmp"

  echo
  echo "Listo: TotalMD $version publicada y anunciada."
  echo "Las apps instaladas mostrarán el aviso de actualización al abrirse."
}

if [[ "${1:-}" == "--anunciar" ]]; then
  VERSION="${2:-}"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "uso: $0 --anunciar X.Y.Z"
  NOTES="$(gh release view "v$VERSION" --repo "$REPO" --json body --jq .body | sed '/^\*\*Instalar o actualizar/,$d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
  announce "$VERSION" "$NOTES"
  exit 0
fi

VERSION="${1:-}"
NOTES="${2:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "uso: $0 X.Y.Z \"notas\""
[[ -n "$NOTES" ]] || die "escribe las notas de la versión entre comillas"
[[ -f "$KEY" ]] || die "no existe la clave de firma $KEY"

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

DEB="$BUNDLE/TotalMD_${VERSION}_amd64.deb"
[[ -f "$DEB" && -f "$DEB.sig" ]] || die "no se generó $DEB o su firma"

echo "==> Commit, etiqueta y push a $REPO"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "Versión $VERSION" -m "$NOTES"
git tag -a "v$VERSION" -m "TotalMD $VERSION"
git push -q --follow-tags origin main

echo "==> Release en $REPO"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp "$DEB" "$OUT/"
cp "$DEB" "$OUT/TotalMD_amd64.deb" # nombre fijo: enlace estable para install.sh
INSTALL="curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
RELEASE_NOTES="$NOTES"$'\n\n'"**Instalar o actualizar:**"$'\n\n```bash\n'"$INSTALL"$'\n```'
gh release create "v$VERSION" --repo "$REPO" --title "TotalMD $VERSION" --notes "$RELEASE_NOTES" \
  "$OUT/TotalMD_${VERSION}_amd64.deb" "$OUT/TotalMD_amd64.deb"

announce "$VERSION" "$NOTES"
