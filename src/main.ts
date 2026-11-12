// TotalMD — controlador principal de la interfaz.
import "./styles/app.css";
import "./styles/preview.css";
import "./styles/print.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./styles/hljs-dark.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";

import * as api from "./api";
import { basename, dirname, hasScheme, isDocFile, isMermaidFile, resolve, safeDecode } from "./path";
import { initEditor, createState, getView, showState, setEditorDark, topVisibleLine, scrollToLine } from "./editor/editor";
import { renderDocument, countWords } from "./preview/render";
import { renderMermaidBlocks, setMermaidTheme, type MermaidStats } from "./preview/mermaid";
import { initScrollSync, rebuildAnchors, syncFromEditor, syncFromPreview, previewTopLine, scrollPreviewToLine } from "./preview/scrollSync";
import { initSidebar, loadFolder, refreshTree, setActiveInTree, getRoot, showContextMenu, hideContextMenu } from "./sidebar/tree";
import { exportHtml, exportPdf, exportSvg, exportPng } from "./export/export";
import { askUnsaved, toast, openDiagramViewer } from "./ui/dialogs";
import { initUpdater, checkForUpdate, installUpdate, dismissUpdate } from "./updater";
import { settings, loadSettings, saveSetting, addRecent, removeRecent, clearRecent, type Mode } from "./state/settings";
import { tabs, createTab, activeTab, setActiveId, findByPath, removeTab, renderTabBar, tabTitle, type Tab } from "./state/tabs";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const workspace = $("#workspace");
const previewPane = $("#preview-pane");
const preview = $("#preview");
const tabbar = $("#tabbar");
const appWindow = api.isTauri ? getCurrentWindow() : null;

let renderGen = 0;
let renderTimer = 0;
let statsTimer = 0;
let previewStale = true;
let darkMode = false;
let lastStats: MermaidStats = { ok: 0, errors: 0 };
let pendingAnchor: string | null = null;
const fsTimers = new Map<string, number>();

// ───────────────────────── Errores → log del backend ─────────────────────────
window.addEventListener("error", (e) => api.log("error", `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => api.log("error", `promesa rechazada: ${e.reason?.stack ?? e.reason}`));

function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  api.log("error", msg);
  toast(msg, "error");
}

// ───────────────────────────────── Tema ─────────────────────────────────
async function applyTheme(): Promise<void> {
  let dark: boolean;
  if (settings.theme === "system") {
    await appWindow?.setTheme(null).catch(() => {});
    const t = await appWindow?.theme().catch(() => null);
    dark = t === "dark" || matchMedia("(prefers-color-scheme: dark)").matches;
  } else {
    dark = settings.theme === "dark";
    await appWindow?.setTheme(settings.theme).catch(() => {});
  }
  const changed = dark !== darkMode || !document.documentElement.dataset.theme;
  darkMode = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme-btn").title = `Tema: ${{ system: "del sistema", light: "claro", dark: "oscuro" }[settings.theme]}`;
  setEditorDark(dark);
  setMermaidTheme(dark ? "dark" : "light");
  if (changed && activeTab()) void renderPreview();
}

function cycleTheme(): void {
  const order = ["system", "light", "dark"] as const;
  saveSetting("theme", order[(order.indexOf(settings.theme) + 1) % order.length]);
  void applyTheme();
  toast(`Tema: ${{ system: "del sistema", light: "claro", dark: "oscuro" }[settings.theme]}`);
}

// ───────────────────────────── Zoom y paneles ─────────────────────────────
function applyZoom(): void {
  document.documentElement.style.setProperty("--zoom", String(settings.zoom));
  $("#st-zoom").textContent = `${Math.round(settings.zoom * 100)}%`;
  getView()?.requestMeasure();
  requestAnimationFrame(rebuildAnchors);
}

function setZoom(z: number): void {
  saveSetting("zoom", Math.min(2.5, Math.max(0.5, Math.round(z * 10) / 10)));
  applyZoom();
}

function applyLayout(): void {
  document.body.classList.toggle("no-sidebar", !settings.sidebar);
  document.documentElement.style.setProperty("--split", String(settings.splitRatio));
  // Los botones de archivo viven arriba de la barra lateral; si se oculta, pasan a la barra superior.
  $(settings.sidebar ? ".sidebar-top" : ".toolbar-left").append($(".file-actions"));
}

function makeResizer(handle: HTMLElement, onMove: (e: PointerEvent) => void, onEnd: () => void): void {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => onMove(ev);
    handle.addEventListener("pointermove", move);
    handle.addEventListener(
      "pointerup",
      () => {
        handle.removeEventListener("pointermove", move);
        document.body.classList.remove("resizing");
        onEnd();
      },
      { once: true },
    );
  });
}

// ───────────────────────────── Vista previa ─────────────────────────────
function renderDelay(tab: Tab): number {
  return Math.min(1200, 200 + tab.state.doc.length / 25_000);
}

function schedulePreview(): void {
  const tab = activeTab();
  if (!tab) return;
  if (tab.mode === "edit") {
    previewStale = true;
    return;
  }
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => void renderPreview(), renderDelay(tab));
}

async function renderPreview(): Promise<MermaidStats> {
  const tab = activeTab();
  if (!tab) return { ok: 0, errors: 0 };
  clearTimeout(renderTimer);
  const gen = ++renderGen;
  const { fragment, mermaidCount } = renderDocument(tab.state.doc.toString(), tab.path, tab.isMermaid);
  preview.classList.toggle("mermaid-only", tab.isMermaid);
  preview.replaceChildren(fragment);
  previewStale = false;
  rebuildAnchors();
  const stats = mermaidCount ? await renderMermaidBlocks(preview, () => gen !== renderGen) : { ok: 0, errors: 0 };
  if (gen === renderGen) {
    lastStats = stats;
    rebuildAnchors();
    updateDiagramStatus();
    if (pendingAnchor) {
      scrollToAnchor(pendingAnchor);
      pendingAnchor = null;
    }
  }
  return stats;
}

function updateDiagramStatus(): void {
  const { ok, errors } = lastStats;
  const el = $("#st-diagrams");
  el.textContent = ok || errors ? `◇ ${ok} diagrama${ok === 1 ? "" : "s"}${errors ? ` · ⚠ ${errors} con error` : ""}` : "";
  el.classList.toggle("warn", errors > 0);
}

function scrollToAnchor(id: string): void {
  const target = preview.querySelector(`[id="${CSS.escape(id)}"]`) ?? preview.querySelector(`[name="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ───────────────────────────── Estado y UI ─────────────────────────────
/** Copia el estado vivo del editor a la pestaña activa. */
function syncActiveState(): void {
  const tab = activeTab();
  const view = getView();
  if (tab && view) {
    tab.state = view.state;
    tab.editorScroll = view.scrollDOM.scrollTop;
    tab.previewScroll = previewPane.scrollTop;
  }
}

function updateTitle(): void {
  const tab = activeTab();
  const title = tab ? `${tab.dirty ? "● " : ""}${tabTitle(tab)} — TotalMD` : "TotalMD";
  document.title = title;
  void appWindow?.setTitle(title).catch(() => {});
}

function updateStatus(): void {
  const tab = activeTab();
  // Marcas LRM: el contenedor usa direction:rtl para recortar por la izquierda.
  $("#st-path").textContent = tab ? `\u200E${tab.path ?? "Documento nuevo sin guardar"}\u200E` : "";
  $("#st-type").textContent = tab ? (tab.isMermaid ? "Mermaid" : "Markdown") : "";
  updateCursor();
  clearTimeout(statsTimer);
  statsTimer = window.setTimeout(() => {
    const t = activeTab();
    $("#st-words").textContent = t ? `${countWords(t.state.doc.toString()).toLocaleString("es")} palabras · ${t.state.doc.lines.toLocaleString("es")} líneas` : "";
  }, 300);
}

function updateCursor(state: EditorState | undefined = activeTab()?.state): void {
  if (!state) {
    $("#st-cursor").textContent = "";
    return;
  }
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  $("#st-cursor").textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
}

function updateConflictBar(): void {
  const tab = activeTab();
  const bar = $("#conflict-bar");
  if (tab && (tab.conflict || tab.deleted)) {
    $("#conflict-text").textContent = tab.deleted
      ? "⚠ El archivo fue eliminado o movido en disco. Guarda para conservarlo."
      : "⚠ El archivo cambió en disco y tienes cambios sin guardar.";
    bar.querySelector<HTMLElement>('[data-action="reload-disk"]')!.hidden = tab.deleted;
    bar.hidden = false;
  } else bar.hidden = true;
}

function refreshChrome(): void {
  renderTabBar(tabbar);
  updateTitle();
  updateStatus();
  updateConflictBar();
  setActiveInTree(activeTab()?.path ?? null);
  const empty = tabs.length === 0;
  $("#welcome").hidden = !empty;
  workspace.classList.toggle("empty", empty);
}

let selftestRunning = false;

function saveSession(): void {
  if (selftestRunning) return;
  saveSetting("session", tabs.filter((t) => t.path).map((t) => t.path!));
  saveSetting("activeSession", activeTab()?.path ?? null);
}

// ───────────────────────────── Modos ─────────────────────────────
function applyModeUI(mode: Mode): void {
  workspace.dataset.mode = mode;
  document.querySelectorAll<HTMLElement>("#toolbar [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

function setMode(mode: Mode, tab = activeTab()): void {
  if (!tab) return;
  const prev = tab.mode;
  // Conserva la posición de lectura al cambiar de modo.
  const line = prev === "view" ? previewTopLine() : topVisibleLine();
  tab.mode = mode;
  applyModeUI(mode);
  requestAnimationFrame(async () => {
    getView().requestMeasure();
    if (mode !== "edit" && previewStale) await renderPreview();
    else rebuildAnchors();
    if (prev !== mode) {
      if (mode === "edit" || (mode === "split" && prev === "view")) scrollToLine(line);
      if (mode === "view" || (mode === "split" && prev === "edit")) scrollPreviewToLine(Math.floor(line));
    }
    if (mode !== "view") getView().focus();
  });
}

// ───────────────────────────── Pestañas ─────────────────────────────
function activateTab(tab: Tab | null): void {
  if (activeTab() !== tab) syncActiveState();
  setActiveId(tab?.id ?? null);
  if (!tab) {
    preview.replaceChildren();
    lastStats = { ok: 0, errors: 0 };
    updateDiagramStatus();
    refreshChrome();
    saveSession();
    return;
  }
  showState(tab.state, tab.editorScroll);
  previewStale = true;
  applyModeUI(tab.mode);
  const scroll = tab.previewScroll;
  if (tab.mode !== "edit") void renderPreview().then(() => (previewPane.scrollTop = scroll));
  else preview.replaceChildren();
  refreshChrome();
  saveSession();
}

function detectEol(text: string): Tab["eol"] {
  const i = text.indexOf("\n");
  return i > 0 && text[i - 1] === "\r" ? "\r\n" : "\n";
}

async function openFile(path: string, opts: { activate?: boolean; mode?: Mode } = {}): Promise<Tab | null> {
  const existing = findByPath(path);
  if (existing) {
    if (opts.activate !== false) activateTab(existing);
    return existing;
  }
  try {
    const text = await api.readFile(path);
    const tab = createTab(path, createState(text, isMermaidFile(path)), opts.mode ?? "view", detectEol(text));
    void api.watchFile(path);
    addRecent(path);
    if (opts.activate !== false) activateTab(tab);
    else refreshChrome();
    void refreshTree(settings.recent);
    return tab;
  } catch (e) {
    reportError(e);
    return null;
  }
}

function newFile(): void {
  const tab = createTab(null, createState("", false), "split");
  activateTab(tab);
}

async function saveTab(tab: Tab, saveAs = false): Promise<boolean> {
  if (tab === activeTab()) syncActiveState();
  let path = tab.path;
  if (!path || saveAs) {
    if (!api.isTauri) {
      toast("Guardar solo está disponible en la app de escritorio", "error");
      return false;
    }
    const chosen = await saveDialog({
      defaultPath: path ?? `${getRoot() ? `${getRoot()}/` : ""}${tabTitle(tab)}.md`,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Mermaid", extensions: ["mmd"] },
      ],
    });
    if (!chosen) return false;
    path = chosen;
  }
  const doc = tab.state.doc;
  try {
    await api.writeFile(path, doc.sliceString(0, doc.length, tab.eol));
  } catch (e) {
    reportError(e);
    return false;
  }
  if (path !== tab.path) {
    if (tab.path) void api.unwatchFile(tab.path);
    void api.watchFile(path);
    const wasMermaid = tab.isMermaid;
    tab.path = path;
    tab.isMermaid = isMermaidFile(path);
    if (wasMermaid !== tab.isMermaid) {
      tab.state = createState(doc.toString(), tab.isMermaid);
      if (tab === activeTab()) showState(tab.state, tab.editorScroll);
    }
    addRecent(path);
    void refreshTree(settings.recent);
  }
  tab.saved = tab.state.doc;
  tab.dirty = false;
  tab.conflict = false;
  tab.deleted = false;
  refreshChrome();
  saveSession();
  if (tab === activeTab()) schedulePreview();
  toast(`Guardado: ${basename(path)}`);
  return true;
}

async function closeTab(tab: Tab): Promise<boolean> {
  if (tab === activeTab()) syncActiveState();
  if (tab.dirty) {
    activateTab(tab);
    const choice = await askUnsaved(tabTitle(tab));
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveTab(tab))) return false;
  }
  if (tab.path && !tabs.some((t) => t !== tab && t.path === tab.path)) void api.unwatchFile(tab.path);
  const wasActive = tab === activeTab();
  const next = removeTab(tab);
  if (wasActive) activateTab(next);
  else refreshChrome();
  saveSession();
  return true;
}

function cycleTab(dir: 1 | -1): void {
  const tab = activeTab();
  if (!tab || tabs.length < 2) return;
  activateTab(tabs[(tabs.indexOf(tab) + dir + tabs.length) % tabs.length]);
}

// ───────────────────────────── Diálogos de abrir ─────────────────────────────
async function pickFiles(): Promise<void> {
  if (!api.isTauri) return toast("Abrir archivos solo está disponible en la app de escritorio", "error");
  const res = await openDialog({
    multiple: true,
    defaultPath: getRoot() ?? undefined,
    filters: [
      { name: "Markdown y Mermaid", extensions: ["md", "markdown", "mdown", "mkd", "mmd", "mermaid"] },
      { name: "Todos los archivos", extensions: ["*"] },
    ],
  });
  for (const p of res ?? []) await openFile(p);
}

async function pickFolder(): Promise<void> {
  if (!api.isTauri) return;
  const dir = await openDialog({ directory: true, defaultPath: getRoot() ?? undefined });
  if (typeof dir === "string") await openFolder(dir);
}

async function openFolder(dir: string | null): Promise<void> {
  saveSetting("folder", dir);
  await loadFolder(dir);
  void api.watchTree(dir);
  if (dir && !settings.sidebar) toggleSidebar();
}

function toggleSidebar(): void {
  saveSetting("sidebar", !settings.sidebar);
  applyLayout();
  getView().requestMeasure();
}

// ───────────────────────────── Cambios en disco ─────────────────────────────
async function checkExternal(tab: Tab): Promise<void> {
  if (!tab.path) return;
  const st = await api.statFile(tab.path);
  if (!st.exists) {
    tab.deleted = true;
    tab.dirty = true;
    refreshChrome();
    return;
  }
  const text = await api.readFile(tab.path);
  const normalized = text.replace(/\r\n?/g, "\n");
  if (tab === activeTab()) syncActiveState();
  tab.deleted = false;
  if (normalized === tab.saved.toString()) {
    // Es nuestro propio guardado (o no cambió nada).
    refreshChrome();
    return;
  }
  if (tab.dirty) {
    tab.conflict = true;
    refreshChrome();
    return;
  }
  reloadFromDisk(tab, text);
}

function reloadFromDisk(tab: Tab, text: string): void {
  const normalized = text.replace(/\r\n?/g, "\n");
  tab.eol = detectEol(text);
  if (tab === activeTab()) {
    const view = getView();
    const previewScroll = previewPane.scrollTop;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: normalized },
      selection: { anchor: Math.min(view.state.selection.main.head, normalized.length) },
    });
    tab.state = view.state;
    tab.saved = view.state.doc;
    tab.dirty = false;
    tab.conflict = false;
    if (tab.mode !== "edit") void renderPreview().then(() => (previewPane.scrollTop = previewScroll));
    else previewStale = true;
  } else {
    const tr = tab.state.update({ changes: { from: 0, to: tab.state.doc.length, insert: normalized } });
    tab.state = tr.state;
    tab.saved = tr.state.doc;
    tab.dirty = false;
    tab.conflict = false;
  }
  refreshChrome();
}

function onFsChange(change: api.FsChange): void {
  if (change.source === "tree") {
    if (change.kind !== "modify" || change.paths.some(isDocFile)) {
      clearTimeout(fsTimers.get("__tree__"));
      fsTimers.set("__tree__", window.setTimeout(() => void refreshTree(settings.recent), 400));
    }
  }
  for (const p of change.paths) {
    const tab = findByPath(p);
    if (!tab) continue;
    clearTimeout(fsTimers.get(p));
    fsTimers.set(p, window.setTimeout(() => void checkExternal(tab).catch(reportError), 200));
  }
}

// ───────────────────────────── Interacción con la vista ─────────────────────────────
function toggleTaskAt(li: HTMLElement): void {
  const tab = activeTab();
  const lineAttr = li.dataset.line;
  if (!tab || lineAttr === undefined) return;
  const view = getView();
  const line = view.state.doc.line(Number(lineAttr) + 1);
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text);
  if (!m) return;
  const pos = line.from + m[1].length;
  view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === " " ? "x" : " " } });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Texto de un bloque de código tal como está en el documento (sin el salto de línea final). */
function codeBlockText(wrap: Element): string {
  return (wrap.querySelector("pre")?.textContent ?? "").replace(/\n$/, "");
}

async function copyCodeBlock(button: HTMLElement): Promise<void> {
  const wrap = button.closest(".code-wrap");
  if (!wrap) return;
  await copyText(codeBlockText(wrap));
  button.textContent = "✓ Copiado";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = "Copiar";
    button.classList.remove("copied");
  }, 1500);
}

async function onDiagramAction(action: string, block: HTMLElement): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const svg = block.querySelector<SVGSVGElement>(".mermaid-svg svg");
  const index = [...preview.querySelectorAll(".mermaid-block")].indexOf(block);
  const src = block.dataset.src ?? "";
  const title = tabTitle(tab);
  switch (action) {
    case "mmd-zoom":
      if (svg) openDiagramViewer(svg);
      break;
    case "mmd-copy":
      await copyText(src);
      toast("Código del diagrama copiado");
      break;
    case "mmd-svg":
      if (svg) {
        const p = await exportSvg(svg, tab.path, title, index);
        if (p) toast(`SVG exportado: ${basename(p)}`);
      }
      break;
    case "mmd-png": {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
      const p = await exportPng(src, tab.path, title, index, bg);
      if (p) toast(`PNG exportado: ${basename(p)}`);
      break;
    }
  }
}

async function onLinkClick(a: HTMLAnchorElement): Promise<void> {
  const href = a.getAttribute("href") ?? "";
  if (!href) return;
  if (href.startsWith("#")) return scrollToAnchor(safeDecode(href.slice(1)));
  if (hasScheme(href)) {
    if (/^(https?|mailto|ftp):/i.test(href)) await openUrl(href);
    return;
  }
  const tab = activeTab();
  if (!tab?.path) return toast("Guarda el documento para abrir enlaces relativos", "error");
  const [rawPath, hash] = href.split("#");
  const target = resolve(dirname(tab.path), safeDecode(rawPath));
  if (isDocFile(target)) {
    const st = await api.statFile(target);
    if (!st.exists) return toast(`No existe: ${target}`, "error");
    pendingAnchor = hash ? safeDecode(hash) : null;
    const opened = await openFile(target);
    if (opened && pendingAnchor && opened === activeTab()) {
      scrollToAnchor(pendingAnchor);
    }
  } else {
    await openPath(target).catch(reportError);
  }
}

// ───────────────────────────── Buscar ─────────────────────────────
function openFind(): void {
  const tab = activeTab();
  if (!tab) return;
  if (tab.mode !== "view") {
    getView().focus();
    openSearchPanel(getView());
    return;
  }
  const bar = $("#findbar");
  bar.hidden = false;
  const input = $<HTMLInputElement>("#find-input");
  input.focus();
  input.select();
}

function findInPreview(backwards: boolean): void {
  const q = $<HTMLInputElement>("#find-input").value;
  if (!q) return;
  // window.find es no estándar pero WebKitGTK lo implementa.
  const w = window as unknown as { find?: (s: string, cs: boolean, back: boolean, wrap: boolean) => boolean };
  const found = w.find?.(q, false, backwards, true);
  $("#find-input").classList.toggle("not-found", found === false);
}

// ───────────────────────────── Acciones ─────────────────────────────
async function runAction(action: string, el?: HTMLElement): Promise<void> {
  const tab = activeTab();
  switch (action) {
    case "new": return newFile();
    case "open": return pickFiles();
    case "open-folder": return pickFolder();
    case "save": if (tab) await saveTab(tab); return;
    case "save-as": if (tab) await saveTab(tab, true); return;
    case "close-tab": if (tab) await closeTab(tab); return;
    case "toggle-sidebar": return toggleSidebar();
    case "cycle-theme": return cycleTheme();
    case "find": return openFind();
    case "find-next": return findInPreview(false);
    case "find-prev": return findInPreview(true);
    case "find-close":
      $("#findbar").hidden = true;
      return;
    case "export-menu": {
      const menu = $("#export-menu");
      menu.hidden = !menu.hidden;
      return;
    }
    case "export-html":
      if (!tab) return;
      if (previewStale) await renderPreview();
      {
        const p = await exportHtml(preview, tab.path, tabTitle(tab), darkMode);
        if (p) toast(`HTML exportado: ${basename(p)}`);
      }
      return;
    case "export-pdf":
      if (!tab) return;
      if (previewStale) await renderPreview();
      return exportPdf();
    case "reveal":
      if (tab?.path) await revealItemInDir(tab.path);
      return;
    case "set-default": {
      const desktop = await api.setAsDefaultApp();
      toast(`TotalMD es ahora la app predeterminada para .md y .mmd (${desktop})`);
      return;
    }
    case "refresh-tree": return refreshTree(settings.recent);
    case "recent-remove":
      if (el?.dataset.path) {
        removeRecent(el.dataset.path);
        await refreshTree(settings.recent);
        toast("Quitado de la lista (el archivo sigue en el disco)");
      }
      return;
    case "recent-clear":
      clearRecent();
      return refreshTree(settings.recent);
    case "path-open": if (el?.dataset.path) await openFile(el.dataset.path); return;
    case "path-reveal": if (el?.dataset.path) await revealItemInDir(el.dataset.path); return;
    case "path-copy":
      if (el?.dataset.path) {
        await copyText(el.dataset.path);
        toast("Ruta copiada");
      }
      return;
    case "close-folder": return openFolder(null);
    case "reload-disk":
      if (tab?.path) reloadFromDisk(tab, await api.readFile(tab.path));
      return;
    case "code-copy": if (el) await copyCodeBlock(el); return;
    case "check-update": return checkForUpdate(false);
    case "install-update": return installUpdate();
    case "dismiss-update": return dismissUpdate();
    case "keep-mine":
      if (tab) {
        tab.conflict = false;
        refreshChrome();
      }
      return;
    default:
      if (action.startsWith("mmd-") && el) {
        const block = el.closest<HTMLElement>(".mermaid-block");
        if (block) return onDiagramAction(action, block);
      }
  }
}

function bindEvents(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".menu-wrap")) $("#export-menu").hidden = true;
    if (!target.closest("#ctx-menu") || target.closest("[data-action]")) hideContextMenu();

    const modeBtn = target.closest<HTMLElement>("#toolbar [data-mode]");
    if (modeBtn) return setMode(modeBtn.dataset.mode as Mode);

    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (actionEl) {
      if (actionEl.closest(".menu")) $("#export-menu").hidden = true;
      void runAction(actionEl.dataset.action!, actionEl).catch(reportError);
    }
  });

  tabbar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const close = target.closest<HTMLElement>("[data-close]");
    const id = Number((close ?? target.closest<HTMLElement>("[data-tab]"))?.dataset[close ? "close" : "tab"]);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (close) void closeTab(tab);
    else activateTab(tab);
  });
  tabbar.addEventListener("auxclick", (e) => {
    // Clic central cierra la pestaña, como en los navegadores.
    const id = Number((e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab);
    const tab = tabs.find((t) => t.id === id);
    if (e.button === 1 && tab) void closeTab(tab);
  });
  tabbar.addEventListener("wheel", (e) => {
    tabbar.scrollLeft += e.deltaY;
  }, { passive: true });

  preview.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.matches("input.task-list-item-checkbox")) {
      e.preventDefault();
      const li = target.closest<HTMLElement>("li[data-line]");
      if (li) toggleTaskAt(li);
      return;
    }
    const a = target.closest<HTMLAnchorElement>("a[href]");
    if (a) {
      e.preventDefault();
      void onLinkClick(a).catch(reportError);
    }
  });
  preview.addEventListener("dblclick", (e) => {
    const svg = (e.target as HTMLElement).closest(".mermaid-svg")?.querySelector("svg");
    if (svg) openDiagramViewer(svg);
  });

  previewPane.addEventListener("scroll", () => {
    if (activeTab()?.mode === "split" && settings.syncScroll) syncFromPreview();
  }, { passive: true });
  // Las imágenes cambian la altura del documento al cargar.
  preview.addEventListener("load", () => requestAnimationFrame(rebuildAnchors), true);
  new ResizeObserver(() => rebuildAnchors()).observe(preview);

  const find = $<HTMLInputElement>("#find-input");
  find.addEventListener("keydown", (e) => {
    if (e.key === "Enter") findInPreview(e.shiftKey);
    else if (e.key === "Escape") $("#findbar").hidden = true;
  });

  makeResizer($("#sidebar-resizer"), (e) => {
    const w = Math.min(600, Math.max(160, e.clientX));
    document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
  }, () => getView().requestMeasure());
  makeResizer($("#split-resizer"), (e) => {
    const r = workspace.getBoundingClientRect();
    const ratio = Math.min(0.85, Math.max(0.15, (e.clientX - r.left) / r.width));
    settings.splitRatio = ratio;
    document.documentElement.style.setProperty("--split", String(ratio));
  }, () => {
    saveSetting("splitRatio", settings.splitRatio);
    getView().requestMeasure();
    rebuildAnchors();
  });

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("resize", hideContextMenu);
  window.addEventListener("beforeprint", () => document.body.classList.add("printing"));
  window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => settings.theme === "system" && void applyTheme());
}

function onKeyDown(e: KeyboardEvent): void {
  if (document.querySelector(".modal-overlay")) return;
  if (e.key === "Escape" && !$("#ctx-menu").hidden) {
    hideContextMenu();
    e.preventDefault();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const tab = activeTab();
  let handled = true;

  if (ctrl && e.shiftKey && key === "o") void pickFolder();
  else if (ctrl && e.shiftKey && key === "s") void runAction("save-as");
  else if (ctrl && key === "Tab") cycleTab(e.shiftKey ? -1 : 1);
  else if (ctrl && key === "PageDown") cycleTab(1);
  else if (ctrl && key === "PageUp") cycleTab(-1);
  else if (ctrl && !e.shiftKey && !e.altKey) {
    switch (key) {
      case "n": newFile(); break;
      case "o": void pickFiles(); break;
      case "s": void runAction("save"); break;
      case "w": void runAction("close-tab"); break;
      case "1": setMode("view"); break;
      case "2": setMode("edit"); break;
      case "3": setMode("split"); break;
      case "e": if (tab) setMode(tab.mode === "view" ? "edit" : "view"); break;
      case "b": toggleSidebar(); break;
      case "p": void runAction("export-pdf"); break;
      case "f":
        if (tab?.mode === "view") openFind();
        else if (!getView().hasFocus) openFind();
        else handled = false; // CodeMirror abre su propio buscador
        break;
      case "=": case "+": setZoom(settings.zoom + 0.1); break;
      case "-": setZoom(settings.zoom - 0.1); break;
      case "0": setZoom(1); break;
      default: handled = false;
    }
  } else if (ctrl && e.shiftKey && (key === "+" || key === "=")) setZoom(settings.zoom + 0.1);
  else if (key === "F3") findInPreview(e.shiftKey);
  else handled = false;

  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// ───────────────────────────── Integración con la ventana ─────────────────────────────
async function bindWindow(): Promise<void> {
  if (!appWindow) return;
  await listen<string[]>("open-files", async ({ payload }) => {
    for (const p of payload) await openFile(p);
  });
  await listen<api.FsChange>("fs-change", ({ payload }) => onFsChange(payload));
  await appWindow.onThemeChanged(() => settings.theme === "system" && void applyTheme());
  await appWindow.onDragDropEvent(async ({ payload }) => {
    document.body.classList.toggle("dragging", payload.type === "enter" || payload.type === "over");
    if (payload.type !== "drop") return;
    for (const p of payload.paths) {
      const st = await api.statFile(p);
      if (st.is_dir) await openFolder(p);
      else if (isDocFile(p)) await openFile(p);
      else toast(`No es un archivo Markdown o Mermaid: ${basename(p)}`, "error");
    }
  });
  await appWindow.onCloseRequested(async (event) => {
    syncActiveState();
    saveSession();
    if (!tabs.some((t) => t.dirty)) return;
    event.preventDefault();
    if (await confirmUnsavedAll()) await appWindow.destroy();
  });
}

/** Pregunta por cada pestaña con cambios. Devuelve false si el usuario cancela. */
async function confirmUnsavedAll(): Promise<boolean> {
  syncActiveState();
  for (const tab of tabs.filter((t) => t.dirty)) {
    activateTab(tab);
    const choice = await askUnsaved(tabTitle(tab));
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveTab(tab))) return false;
  }
  saveSession();
  return true;
}

// ───────────────────────────── Autoprueba ─────────────────────────────
/** `totalmd --selftest archivo...`: renderiza cada archivo, informa por stdout y sale. */
async function runSelftest(): Promise<void> {
  selftestRunning = true;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name: string) => {
    await pause(400);
    await api.snapshot(name);
  };
  let failures = 0;
  for (const [i, tab] of [...tabs].entries()) {
    activateTab(tab);
    setMode("split");
    const t0 = performance.now();
    const stats = await renderPreview();
    const ms = Math.round(performance.now() - t0);
    const count = (sel: string) => preview.querySelectorAll(sel).length;
    api.log(
      "info",
      `SELFTEST ${basename(tab.path ?? "?")}: ${ms} ms · mermaid ok=${stats.ok} err=${stats.errors} · h=${count("h1,h2,h3,h4,h5,h6")} tablas=${count("table")} katex=${count(".katex")} codigo=${count("pre code.hljs, pre code[class*=language-]")} tareas=${count(".task-list-item")} notas=${count(".footnote-item")} imgs=${count("img")}`,
    );
    preview.querySelectorAll<HTMLElement>(".mermaid-error").forEach((b) => api.log("info", `SELFTEST   error: ${b.querySelector("pre")?.textContent?.split("\n")[0]} | src(${(b.dataset.src ?? "").length})=${JSON.stringify((b.dataset.src ?? "").slice(0, 40))}`));
    if (stats.ok === 0 && stats.errors > 0) failures++;
    const blocks = preview.querySelectorAll(".code-wrap");
    if (blocks.length) {
      api.log("info", `SELFTEST   bloques de código=${blocks.length} · primero (${blocks[0].querySelector(".code-lang")?.textContent || "sin lenguaje"}): ${JSON.stringify(codeBlockText(blocks[0]))}`);
    }
    preview.querySelectorAll<SVGSVGElement>(".mermaid-svg svg").forEach((svg, n) => {
      if (n < 3) api.log("info", `SELFTEST   svg${n}: width=${svg.getAttribute("width")} style=${svg.getAttribute("style")} viewBox=${svg.getAttribute("viewBox")} rect=${Math.round(svg.getBoundingClientRect().width)}x${Math.round(svg.getBoundingClientRect().height)}`);
    });

    await shot(`${i}-dividido`);
    setMode("view");
    await shot(`${i}-vista`);
    if (i === 0) {
      preview.querySelector(".code-wrap")?.scrollIntoView({ block: "start" });
      await shot(`${i}-codigo`);
      for (const [n, idx] of [[1, 0], [2, 6], [3, 10]] as const) {
        preview.querySelectorAll<HTMLElement>(".mermaid-block")[idx]?.scrollIntoView({ block: "start" });
        await shot(`${i}-diagramas-${n}`);
      }
      const original = settings.theme;
      settings.theme = "dark";
      await applyTheme();
      await renderPreview();
      preview.querySelectorAll<HTMLElement>(".mermaid-block")[0]?.scrollIntoView({ block: "start" });
      await shot(`${i}-oscuro-vista`);
      preview.querySelector(".code-wrap")?.scrollIntoView({ block: "start" });
      await shot(`${i}-oscuro-codigo`);
      setMode("split");
      await shot(`${i}-oscuro-dividido`);
      settings.theme = original;
      await applyTheme();

      // Barra lateral oculta, sin guardar el ajuste.
      const sidebar = settings.sidebar;
      settings.sidebar = false;
      applyLayout();
      await shot(`${i}-sin-lateral`);
      settings.sidebar = sidebar;
      applyLayout();

      // Menú contextual de Recientes (solo se muestra; no se quita nada).
      const row = document.querySelector<HTMLElement>("#sidebar .tree-row.recent");
      if (row) {
        const r = row.getBoundingClientRect();
        showContextMenu(row, r.left + 40, r.bottom);
        api.log("info", `SELFTEST   menú de recientes: ${[...$("#ctx-menu").querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
        await shot(`${i}-menu-recientes`);
        hideContextMenu();
      } else api.log("info", "SELFTEST   sin recientes para probar el menú");
    }
  }
  await api.exitApp(failures ? 1 : 0);
}

// ───────────────────────────── Arranque ─────────────────────────────
async function main(): Promise<void> {
  await loadSettings();
  applyLayout();
  applyZoom();

  initEditor($("#editor-pane"), {
    onChange(state) {
      const tab = activeTab();
      if (!tab) return;
      tab.state = state;
      const dirty = tab.deleted || !state.doc.eq(tab.saved);
      if (dirty !== tab.dirty) {
        tab.dirty = dirty;
        renderTabBar(tabbar);
        updateTitle();
      }
      schedulePreview();
      updateStatus();
    },
    onCursor: (state) => updateCursor(state),
    onScroll() {
      if (activeTab()?.mode === "split" && settings.syncScroll) syncFromEditor();
    },
  });
  initScrollSync(previewPane);
  initSidebar($("#sidebar"), (p) => void openFile(p));
  bindEvents();
  await applyTheme();
  await bindWindow();

  if (settings.folder) {
    const st = await api.statFile(settings.folder);
    await openFolder(st.exists && st.is_dir ? settings.folder : null);
  } else await refreshTree(settings.recent);

  const startup = await api.takeStartupFiles();
  const selftest = await api.isSelftest();
  if (startup.length) {
    for (const p of startup) await openFile(p, { activate: false });
    activateTab(tabs[tabs.length - 1] ?? null);
  } else if (!selftest) {
    // Restaura la sesión anterior.
    for (const p of settings.session) {
      if ((await api.statFile(p)).exists) await openFile(p, { activate: false });
    }
    activateTab((settings.activeSession && findByPath(settings.activeSession)) || tabs[0] || null);
  }
  if (!api.isTauri && !tabs.length) {
    // Modo navegador (pnpm dev): abre el ejemplo para poder probar la interfaz.
    await openFile("/samples/ejemplo-completo.md");
  }
  refreshChrome();

  await initUpdater(confirmUnsavedAll);
  if (selftest) await runSelftest();
  else setTimeout(() => void checkForUpdate(true), 4000);
}

void main().catch(reportError);
