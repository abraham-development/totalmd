// Renderizado de diagramas Mermaid: carga perezosa, caché por contenido y errores en línea.
import type { Mermaid, MermaidConfig } from "mermaid";

type Cached = { ok: true; svg: string } | { ok: false; error: string };

let mermaidPromise: Promise<Mermaid> | null = null;
let currentTheme: "light" | "dark" = "light";
const cache = new Map<string, Cached>();
let idCounter = 0;

function baseConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: currentTheme === "dark" ? "dark" : "default",
    fontFamily: "Ubuntu, 'Noto Sans', 'DejaVu Sans', sans-serif",
    suppressErrorRendering: true,
    maxTextSize: 500_000,
  };
}

/** Mermaid pesa ~2 MB: solo se carga cuando algún documento tiene diagramas. */
function getMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then(({ default: m }) => {
    m.initialize(baseConfig());
    return m;
  });
  return mermaidPromise;
}

export function setMermaidTheme(theme: "light" | "dark"): void {
  if (theme === currentTheme) return;
  currentTheme = theme;
  if (mermaidPromise) void mermaidPromise.then((m) => m.initialize(baseConfig()));
}

function hashKey(src: string): string {
  // FNV-1a de 32 bits + longitud: suficiente para indexar la caché.
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${currentTheme}:${src.length}:${(h >>> 0).toString(36)}`;
}

function cleanupStray(id: string): void {
  // Ante un error, Mermaid puede dejar nodos temporales en <body>.
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

async function renderSource(src: string, config?: MermaidConfig): Promise<Cached> {
  const m = await getMermaid();
  const id = `mmd-${++idCounter}`;
  try {
    if (config) m.initialize({ ...baseConfig(), ...config });
    const { svg } = await m.render(id, src);
    return { ok: true, svg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    if (config) m.initialize(baseConfig());
    cleanupStray(id);
  }
}

const TOOLBAR = `
  <div class="mermaid-tools" contenteditable="false">
    <button data-action="mmd-zoom" title="Ampliar">⤢</button>
    <button data-action="mmd-copy" title="Copiar código">⧉</button>
    <button data-action="mmd-svg" title="Exportar SVG">SVG</button>
    <button data-action="mmd-png" title="Exportar PNG">PNG</button>
  </div>`;

function fill(block: HTMLElement, result: Cached): void {
  if (result.ok) {
    block.classList.remove("mermaid-error");
    block.innerHTML = `${TOOLBAR}<div class="mermaid-svg">${result.svg}</div>`;
    // WebKitGTK resuelve mal width="100%" en estos SVG (quedan de ~18 px): se fija el ancho natural.
    const svg = block.querySelector<SVGSVGElement>(".mermaid-svg svg");
    const vb = svg?.viewBox.baseVal;
    if (svg && vb && vb.width > 0) {
      svg.removeAttribute("width");
      svg.style.width = `${vb.width}px`;
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
    }
  } else {
    block.classList.add("mermaid-error");
    const pre = document.createElement("pre");
    pre.textContent = result.error;
    const src = document.createElement("pre");
    src.className = "mermaid-error-src";
    src.textContent = block.dataset.src ?? "";
    block.innerHTML = `<div class="mermaid-error-title">⚠ Error en el diagrama Mermaid</div>`;
    block.append(pre, src);
  }
}

export interface MermaidStats {
  ok: number;
  errors: number;
}

/**
 * Rellena los bloques Mermaid de `root`. Los que ya están en caché se pintan
 * en el acto (sin parpadeo); el resto se renderizan en orden.
 */
export async function renderMermaidBlocks(root: ParentNode, isStale: () => boolean = () => false): Promise<MermaidStats> {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block")];
  const pending: HTMLElement[] = [];
  const stats: MermaidStats = { ok: 0, errors: 0 };

  for (const block of blocks) {
    const hit = cache.get(hashKey(block.dataset.src ?? ""));
    if (hit) {
      fill(block, hit);
      stats[hit.ok ? "ok" : "errors"]++;
    } else {
      block.classList.add("mermaid-loading");
      pending.push(block);
    }
  }

  for (const block of pending) {
    if (isStale()) break;
    const src = block.dataset.src ?? "";
    const key = hashKey(src);
    const result = cache.get(key) ?? (await renderSource(src));
    if (cache.size > 300) cache.clear();
    cache.set(key, result);
    block.classList.remove("mermaid-loading");
    fill(block, result);
    stats[result.ok ? "ok" : "errors"]++;
  }
  return stats;
}

/** SVG del diagrama con etiquetas en texto SVG puro (necesario para rasterizar a PNG). */
export async function renderForRaster(src: string): Promise<string> {
  const r = await renderSource(src, { htmlLabels: false, flowchart: { htmlLabels: false } } as MermaidConfig);
  if (!r.ok) throw new Error(r.error);
  return r.svg;
}

export function hasMermaidLoaded(): boolean {
  return mermaidPromise !== null;
}
