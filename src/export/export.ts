// Exportación: HTML autónomo, PDF (impresión), y SVG/PNG por diagrama.
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri, writeBinary, writeFile, type PrintResult } from "../api";
import { basename, dirname } from "../path";
import { renderForRaster } from "../preview/mermaid";
import previewCss from "../styles/preview.css?inline";
import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";

const KATEX_CDN = "https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css";

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

async function askPath(defaultPath: string, name: string, extensions: string[]): Promise<string | null> {
  if (!isTauri) throw new Error("Exportar solo está disponible en la app de escritorio");
  return save({ defaultPath, filters: [{ name, extensions }] });
}

function suggested(docPath: string | null, title: string, ext: string): string {
  const name = `${stripExt(docPath ? basename(docPath) : title)}.${ext}`;
  return docPath ? `${dirname(docPath)}/${name}` : name;
}

function diagramPath(docPath: string | null, title: string, index: number, ext: string): string {
  return suggested(docPath, title, ext).replace(new RegExp(`\\.${ext}$`), `-diagrama-${index + 1}.${ext}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Copia del contenido renderizado sin controles de la interfaz y con rutas de imagen originales. */
function cleanClone(preview: HTMLElement): HTMLElement {
  const clone = preview.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".mermaid-tools, .code-copy").forEach((el) => el.remove());
  clone.querySelectorAll<HTMLImageElement>("img[data-orig-src]").forEach((img) => {
    img.setAttribute("src", img.dataset.origSrc!);
    img.removeAttribute("data-orig-src");
  });
  clone.querySelectorAll<HTMLElement>(".mermaid-block").forEach((el) => el.removeAttribute("data-src"));
  return clone;
}

export async function exportHtml(preview: HTMLElement, docPath: string | null, title: string, dark: boolean): Promise<string | null> {
  const path = await askPath(suggested(docPath, title, "html"), "HTML", ["html"]);
  if (!path) return null;
  const body = cleanClone(preview);
  const hasMath = body.querySelector(".katex") !== null;
  const html = `<!doctype html>
<html lang="es" data-theme="${dark ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="TotalMD">
<title>${escapeHtml(stripExt(title))}</title>
${hasMath ? `<link rel="stylesheet" href="${KATEX_CDN}">` : ""}
<style>
${previewCss}
${dark ? hljsDark : hljsLight}
body { margin: 0; background: var(--md-bg); }
.markdown-body { max-width: 900px; margin: 0 auto; padding: 32px 24px 64px; }
</style>
</head>
<body>
<article class="markdown-body">
${body.innerHTML}
</article>
</body>
</html>
`;
  await writeFile(path, html);
  return path;
}

/** PDF directo: pide la ruta y genera el archivo (A4, estilo compacto de print.css). */
export async function exportPdf(
  docPath: string | null,
  title: string,
  print: (path: string) => Promise<PrintResult>,
): Promise<{ path: string; pages: number | null } | null> {
  const path = await askPath(suggested(docPath, title, "pdf"), "PDF", ["pdf"]);
  if (!path) return null;
  const { pages } = await print(path);
  return { path, pages };
}

// Medidas de la página A4 impresa en px CSS (96 por pulgada), con los márgenes de print.rs.
const MM = 96 / 25.4;
const PAGE_W = (210 - 2 * 13) * MM; // ≈ 695 px
const PAGE_H = (297 - 2 * 12) * MM; // ≈ 1032 px
/** Los diagramas se dibujan para pantalla (texto ~16 px); al 80 % su texto iguala al del PDF (10 pt). */
const DIAGRAM_SCALE = 0.8;
/** Bloques que no conviene partir entre páginas si son cortos. */
const KEEP_MAX_LINES = 25;

/**
 * Ajusta el documento a la página antes de imprimir: tamaño de los diagramas y qué bloques no
 * deben partirse. Devuelve una función que deshace los cambios.
 */
export function fitForPage(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  const mermaidOnly = root.classList.contains("mermaid-only");
  root.querySelectorAll<SVGSVGElement>(".mermaid-svg svg").forEach((svg) => {
    const vb = svg.viewBox.baseVal;
    if (!vb?.width || !vb.height) return;
    const scale = mermaidOnly
      ? Math.min(1, PAGE_W / vb.width, (PAGE_H - 8) / vb.height)
      : Math.min(DIAGRAM_SCALE, PAGE_W / vb.width, (PAGE_H * 0.6) / vb.height);
    const prev = svg.style.width;
    svg.style.width = `${Math.floor(vb.width * scale)}px`;
    undo.push(() => (svg.style.width = prev));
  });
  // Imágenes: como los diagramas, al 80 % y sin pasar de ~40 % del alto de la página.
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return;
    const scale = Math.min(DIAGRAM_SCALE, PAGE_W / w, (PAGE_H * 0.4) / h);
    const prev = [img.style.width, img.style.height];
    img.style.width = `${Math.floor(w * scale)}px`;
    img.style.height = `${Math.floor(h * scale)}px`;
    undo.push(() => ([img.style.width, img.style.height] = prev));
  });

  const keep = (el: Element) => {
    el.classList.add("pdf-keep");
    undo.push(() => el.classList.remove("pdf-keep"));
  };
  root.querySelectorAll("pre").forEach((pre) => {
    if ((pre.textContent ?? "").split("\n").length <= KEEP_MAX_LINES) keep(pre.closest(".code-wrap") ?? pre);
  });
  root.querySelectorAll("table").forEach((t) => {
    if (t.rows.length <= KEEP_MAX_LINES) keep(t.closest(".table-wrap") ?? t);
  });
  // Un título (o una frase que presenta un bloque, «…:») no debe quedarse sola al final de una
  // página. WebKit no respeta break-after: avoid, así que se agrupa con lo que sigue en un
  // contenedor que no se parte. De abajo arriba, para encadenar «título → título → diagrama».
  const group = (first: Element, next: Element) => {
    const g = document.createElement("div");
    g.className = "pdf-group";
    first.before(g);
    g.append(first, next);
    undo.push(() => g.replaceWith(first, next));
  };
  [...root.querySelectorAll(":scope > p")].reverse().forEach((p) => {
    const next = p.nextElementSibling;
    const text = (p.textContent ?? "").trim();
    if (next && text.length < 300 && (text.endsWith(":") || next.matches(".mermaid-block, .pdf-keep")) && isCompact(next)) group(p, next);
  });
  [...root.querySelectorAll(":scope > :is(h1, h2, h3, h4, h5, h6)")].reverse().forEach((h) => {
    const next = h.nextElementSibling;
    if (next && (isCompact(next) || next.matches("h1, h2, h3, h4, h5, h6"))) group(h, next);
  });

  // Se deshace en orden inverso (primero los grupos, luego clases y tamaños).
  return () => undo.reverse().forEach((f) => f());
}

/** Bloques cortos que conviene mantener unidos a su título. */
function isCompact(el: Element): boolean {
  if (el.matches(".mermaid-block, .pdf-keep, .pdf-group, .katex-display, blockquote")) return true;
  if (el.matches("p")) return (el.textContent ?? "").length < 600 || el.querySelector("img") !== null;
  if (el.matches("ul, ol")) return el.querySelectorAll("li").length <= 8;
  return false;
}

function svgMarkup(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width) {
    clone.setAttribute("width", String(vb.width));
    clone.setAttribute("height", String(vb.height));
    clone.style.removeProperty("max-width");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export async function exportSvg(svg: SVGSVGElement, docPath: string | null, title: string, index: number): Promise<string | null> {
  const path = await askPath(diagramPath(docPath, title, index, "svg"), "SVG", ["svg"]);
  if (!path) return null;
  await writeFile(path, svgMarkup(svg));
  return path;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo rasterizar el SVG"));
    img.src = url;
  });
}

export async function exportPng(source: string, docPath: string | null, title: string, index: number, background: string): Promise<string | null> {
  const path = await askPath(diagramPath(docPath, title, index, "png"), "PNG", ["png"]);
  if (!path) return null;

  // Etiquetas en texto SVG puro: los <foreignObject> contaminan el canvas en WebKit.
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-99999px;top:0;";
  holder.innerHTML = await renderForRaster(source);
  document.body.append(holder);
  try {
    const svg = holder.querySelector("svg")!;
    const vb = svg.viewBox.baseVal;
    const w = Math.ceil(vb?.width || svg.getBoundingClientRect().width);
    const h = Math.ceil(vb?.height || svg.getBoundingClientRect().height);
    const scale = Math.min(3, Math.max(1, 4096 / Math.max(w, h)), 2);
    const markup = svgMarkup(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const img = await loadImage(url);

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar el PNG"))), "image/png"),
    );
    await writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  } finally {
    holder.remove();
  }
}
