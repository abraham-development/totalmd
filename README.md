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

**Paquete .deb (recomendado):**

```bash
pnpm tauri build
sudo apt install ./src-tauri/target/release/bundle/deb/TotalMD_0.1.0_amd64.deb
```

**Solo para tu usuario, sin sudo:** `scripts/install-local.sh` (para desinstalar: `--uninstall`).

Después aparece en **Mostrar aplicaciones**. Para que sea la app por defecto de `.md`/`.mmd`, usa el menú Exportar → «Usar como app predeterminada», o *clic derecho → Abrir con → TotalMD → Establecer como predeterminada* en Nautilus.

Nota técnica: TotalMD arranca con `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Con WebKitGTK 2.52 y Mesa, el renderizador DMA-BUF hacía que el proceso web fallara a veces al cerrar la app (Ubuntu mostraba «WebKitWebProcess has stopped unexpectedly»). Si defines la variable tú mismo, se respeta tu valor.
