# Desarrollo de TotalMD

Guía técnica para compilar TotalMD desde el código y publicar versiones nuevas. Si solo quieres usar la app, mira el [README](README.md).

TotalMD está hecho con [Tauri 2](https://v2.tauri.app) (Rust) sobre el WebKitGTK del sistema. El frontend usa TypeScript con Vite, CodeMirror 6, markdown-it, Mermaid y KaTeX.

## Requisitos (una vez)

```bash
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev libayatana-appindicator3-dev file
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
pnpm install
```

## Comandos

```bash
pnpm tauri dev                       # app con recarga en caliente
pnpm dev                             # solo la interfaz en el navegador (http://localhost:1420)
pnpm typecheck                       # TypeScript
cd src-tauri && cargo clippy         # Rust
```

Autoprueba de renderizado (abre los archivos, los renderiza, informa por consola y sale):

```bash
src-tauri/target/release/totalmd --selftest samples/ejemplo-completo.md samples/diagrama.mmd
```

Con `TOTALMD_SNAPSHOT_DIR=/ruta` guarda además capturas PNG de la ventana en cada modo.

## Compilar e instalar desde el código

```bash
pnpm tauri build
sudo apt install ./src-tauri/target/release/bundle/deb/TotalMD_*_amd64.deb
```

Solo para tu usuario, sin sudo: `scripts/install-local.sh` (para desinstalar: `--uninstall`).

## Publicar una versión nueva

Tras hacer commit de los cambios:

```bash
scripts/publicar.sh 0.2.3 "Qué cambió en esta versión"
```

El script:
1. sube el número de versión;
2. compila y **firma** el `.deb`;
3. hace commit, crea la etiqueta `v0.2.3` y sube el código a GitHub;
4. crea la release;
5. espera a que GitHub sirva el `.deb` y solo entonces la anuncia en `updates/latest.json` y en la release.

Las apps instaladas verán el aviso de actualización al abrirse. Si GitHub tarda demasiado en servir el archivo, el script lo indica. En ese caso, termina el anuncio más tarde con:

```bash
scripts/publicar.sh --anunciar 0.2.3
```

Necesitas `gh` con sesión iniciada y la clave de firma en `~/.tauri/totalmd.key` (o en la ruta de `TOTALMD_SIGNING_KEY`). **Guarda una copia de esa clave en un lugar seguro:** las instalaciones solo aceptan actualizaciones firmadas con ella.

## Notas técnicas

- **Actualizaciones:** `tauri-plugin-updater` lee primero `updates/latest.json` desde raw.githubusercontent.com y, como respaldo, el `latest.json` de la última release. Esto es así porque GitHub devuelve a veces 504 con assets recién subidos. La búsqueda y la descarga se reintentan hasta 3 veces. `TOTALMD_UPDATE_ENDPOINT` permite probar contra un servidor local (solo `http://127.0.0.1`).
- **WebKit:** TotalMD arranca con `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Con WebKitGTK 2.52 y Mesa, el renderizador DMA-BUF hacía que el proceso web fallara a veces al cerrar la app. Si defines la variable tú mismo, se respeta tu valor.
- **Depuración:** los errores del frontend se imprimen en la salida estándar (`[frontend:error] …`). Con `TOTALMD_DEBUG=1` se inyecta además un diagnóstico al cargar la página (errores de carga y de CSP).
