# TotalMD

Visor y editor de escritorio para **Markdown** (`.md`) con soporte completo de **Mermaid**: diagramas embebidos en bloques ```` ```mermaid ```` y archivos `.mmd` sueltos. Hecho con Tauri 2 (Rust) sobre el WebKitGTK del sistema, pensado para Ubuntu 26.04 / GNOME.

## Funciones

- **3 modos:** Vista (`Ctrl+1`), Edición (`Ctrl+2`) y Dividido con vista previa en vivo y scroll sincronizado (`Ctrl+3`).
- **Mermaid:** flowchart, secuencia, clases, estados, ER, Gantt, pie, mindmap, timeline, gitGraph y el resto de tipos. Los diagramas con errores muestran el mensaje en línea sin romper la app. Botones para ampliar (zoom/pan), copiar el código y exportar SVG/PNG. Doble clic sobre un diagrama lo amplía.
- **Markdown completo:** GFM (tablas, tareas clicables, tachado, autoenlaces), notas al pie, emojis, front matter, fórmulas KaTeX, resaltado de código, imágenes relativas.
- **Pestañas, barra lateral con el árbol de la carpeta y archivos recientes.** La sesión se restaura al abrir la app.
- **Recarga automática** si el archivo cambia en disco. Si tienes cambios sin guardar, aparece un aviso de conflicto.
- **Exportar:** HTML autónomo, PDF (vía impresión), SVG/PNG por diagrama.
- Guardado atómico, respeta los finales de línea CRLF, tema claro/oscuro/sistema, zoom, arrastrar y soltar.

## Atajos

| Acción | Atajo |
|---|---|
| Nuevo / Abrir / Abrir carpeta | `Ctrl+N` / `Ctrl+O` / `Ctrl+Mayús+O` |
| Guardar / Guardar como | `Ctrl+S` / `Ctrl+Mayús+S` |
| Cerrar pestaña / cambiar de pestaña | `Ctrl+W` / `Ctrl+Tab`, `Ctrl+RePág/AvPág` |
| Vista / Edición / Dividido / alternar | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+E` |
| Barra lateral | `Ctrl+B` |
| Buscar | `Ctrl+F` (en la vista: `Enter`/`Mayús+Enter`) |
| Imprimir / PDF | `Ctrl+P` |
| Zoom | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |

## Desarrollo

Requisitos (una vez):

```bash
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev libayatana-appindicator3-dev file
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
pnpm install
```

```bash
pnpm tauri dev                       # app con recarga en caliente
pnpm dev                             # solo la interfaz en el navegador (http://localhost:1420)
pnpm typecheck                       # TypeScript
cd src-tauri && cargo clippy         # Rust
```

Autoprueba de renderizado (abre, renderiza, informa por consola y sale):

```bash
src-tauri/target/release/totalmd --selftest samples/ejemplo-completo.md samples/diagrama.mmd
```

## Instalación

En cualquier Ubuntu 26.04 (o derivada con WebKitGTK 4.1), descarga e instala la última versión:

```bash
wget https://github.com/abraham-development/totalmd/releases/latest/download/TotalMD_amd64.deb
sudo apt install ./TotalMD_amd64.deb
```

Después aparece en **Mostrar aplicaciones**. Para que sea la app por defecto de `.md`/`.mmd`, usa el menú Exportar → «Usar como app predeterminada», o *clic derecho → Abrir con → TotalMD → Establecer como predeterminada* en Nautilus.

### Actualizaciones

TotalMD revisa GitHub al abrirse. Si hay una versión nueva, muestra una barra con **Actualizar**: la descarga, verifica su firma, la instala (pide tu contraseña) y se reinicia. También puedes comprobarlo a mano en el menú Exportar → «Buscar actualizaciones».

### Compilar e instalar desde el código

```bash
pnpm tauri build
sudo apt install ./src-tauri/target/release/bundle/deb/TotalMD_*_amd64.deb
```

**Solo para tu usuario, sin sudo:** `scripts/install-local.sh` (para desinstalar: `--uninstall`).

## Publicar una versión nueva

Tras hacer commit de los cambios:

```bash
scripts/publicar.sh 0.2.1 "Qué cambió en esta versión"
```

El script sube el número de versión, compila y **firma** el `.deb`, hace commit y etiqueta `v0.2.1`, sube el código a GitHub y crea la release con el `.deb` y `latest.json`. Las apps instaladas verán el aviso de actualización al abrirse.

Para hacerlo necesitas `gh` con sesión iniciada y la clave de firma en `~/.tauri/totalmd.key` (o en la ruta de `TOTALMD_SIGNING_KEY`). **Guarda una copia de esa clave en un lugar seguro:** las instalaciones solo aceptan actualizaciones firmadas con ella. Si la pierdes, habrá que reinstalar a mano con una clave nueva.

## Notas técnicas

TotalMD arranca con `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Con WebKitGTK 2.52 y Mesa, el renderizador DMA-BUF hacía que el proceso web fallara a veces al cerrar la app (Ubuntu mostraba «WebKitWebProcess has stopped unexpectedly»). Si defines la variable tú mismo, se respeta tu valor.

## Licencia

[MIT](LICENSE) © 2026 Abraham
