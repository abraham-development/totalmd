// Sincronización de scroll entre editor y vista previa usando los data-line.
import { scrollToLine, topVisibleLine } from "../editor/editor";

interface Anchor {
  line: number;
  top: number;
}

let anchors: Anchor[] = [];
let preview: HTMLElement;
/** Lado que originó el último scroll; el otro ignora sus eventos un instante. */
let lock: { side: "editor" | "preview"; until: number } | null = null;

export function initScrollSync(previewEl: HTMLElement): void {
  preview = previewEl;
}

/** Recalcula la posición de cada bloque (tras renderizar o al cambiar tamaños). */
export function rebuildAnchors(): void {
  const base = preview.getBoundingClientRect().top - preview.scrollTop;
  const list: Anchor[] = [{ line: 0, top: 0 }];
  for (const el of preview.querySelectorAll<HTMLElement>("[data-line]")) {
    const line = Number(el.dataset.line);
    const top = el.getBoundingClientRect().top - base;
    // Solo anclas monótonas: los elementos anidados pueden repetir posiciones.
    const last = list[list.length - 1];
    if (line > last.line && top >= last.top) list.push({ line, top });
  }
  anchors = list;
}

function locked(side: "editor" | "preview"): boolean {
  return lock !== null && lock.side !== side && performance.now() < lock.until;
}

function claim(side: "editor" | "preview"): void {
  lock = { side, until: performance.now() + 120 };
}

export function syncFromEditor(): void {
  if (locked("editor") || anchors.length < 2) return;
  claim("editor");
  const line = topVisibleLine();
  let i = anchors.findIndex((a) => a.line > line);
  if (i === -1) i = anchors.length;
  const a = anchors[Math.max(0, i - 1)];
  const b = anchors[i];
  const top = b ? a.top + ((line - a.line) / (b.line - a.line)) * (b.top - a.top) : a.top;
  preview.scrollTop = top;
}

export function syncFromPreview(): void {
  if (locked("preview") || anchors.length < 2) return;
  claim("preview");
  const top = preview.scrollTop;
  let i = anchors.findIndex((a) => a.top > top);
  if (i === -1) i = anchors.length;
  const a = anchors[Math.max(0, i - 1)];
  const b = anchors[i];
  const line = b && b.top > a.top ? a.line + ((top - a.top) / (b.top - a.top)) * (b.line - a.line) : a.line;
  scrollToLine(line);
}

/** Línea de origen visible arriba en la vista previa (para conservar posición al cambiar de modo). */
export function previewTopLine(): number {
  const top = preview.scrollTop;
  let best = 0;
  for (const a of anchors) {
    if (a.top > top) break;
    best = a.line;
  }
  return best;
}

export function scrollPreviewToLine(line: number): void {
  let target = 0;
  for (const a of anchors) {
    if (a.line > line) break;
    target = a.top;
  }
  preview.scrollTop = target;
}
