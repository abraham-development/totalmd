// Modelo de pestañas y su barra.
import type { EditorState, Text } from "@codemirror/state";
import { basename, isMermaidFile } from "../path";
import type { Mode } from "./settings";

export interface Tab {
  id: number;
  path: string | null;
  untitledIndex: number;
  state: EditorState;
  /** Contenido tal como está en disco, para saber si hay cambios. */
  saved: Text;
  dirty: boolean;
  mode: Mode;
  isMermaid: boolean;
  editorScroll: number;
  previewScroll: number;
  /** El archivo cambió en disco mientras la pestaña tenía cambios sin guardar. */
  conflict: boolean;
  deleted: boolean;
  /** Fin de línea original del archivo, se respeta al guardar. */
  eol: "\n" | "\r\n";
}

let nextId = 1;
let untitledCounter = 0;
export const tabs: Tab[] = [];
let activeId: number | null = null;

export function createTab(path: string | null, state: EditorState, mode: Mode, eol: Tab["eol"] = "\n"): Tab {
  const tab: Tab = {
    id: nextId++,
    path,
    untitledIndex: path ? 0 : ++untitledCounter,
    state,
    saved: state.doc,
    dirty: false,
    mode,
    isMermaid: path ? isMermaidFile(path) : false,
    editorScroll: 0,
    previewScroll: 0,
    conflict: false,
    deleted: false,
    eol,
  };
  tabs.push(tab);
  return tab;
}

export function tabTitle(tab: Tab): string {
  if (tab.path) return basename(tab.path);
  return tab.untitledIndex > 1 ? `Sin título ${tab.untitledIndex}` : "Sin título";
}

export function activeTab(): Tab | null {
  return tabs.find((t) => t.id === activeId) ?? null;
}

export function setActiveId(id: number | null): void {
  activeId = id;
}

export function findByPath(path: string): Tab | undefined {
  return tabs.find((t) => t.path === path);
}

export function removeTab(tab: Tab): Tab | null {
  const i = tabs.indexOf(tab);
  if (i >= 0) tabs.splice(i, 1);
  return tabs[Math.min(i, tabs.length - 1)] ?? null;
}

export function renderTabBar(bar: HTMLElement): void {
  bar.replaceChildren(
    ...tabs.map((tab) => {
      const el = document.createElement("div");
      el.className = "tab";
      if (tab.id === activeId) el.classList.add("active");
      if (tab.dirty) el.classList.add("dirty");
      el.dataset.tab = String(tab.id);
      el.title = tab.path ?? tabTitle(tab);
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(tab.id === activeId));
      const icon = document.createElement("span");
      icon.className = "tab-icon";
      icon.textContent = tab.isMermaid ? "◇" : "M↓";
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tabTitle(tab);
      const close = document.createElement("button");
      close.className = "tab-close";
      close.dataset.close = String(tab.id);
      close.title = "Cerrar (Ctrl+W)";
      close.textContent = "×";
      el.append(icon, label, close);
      return el;
    }),
  );
  bar.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
