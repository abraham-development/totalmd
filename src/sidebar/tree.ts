// Barra lateral: árbol de documentos de la carpeta abierta y archivos recientes.
import { listDir, type TreeNode } from "../api";
import { basename, dirname, isMermaidFile } from "../path";

let container: HTMLElement;
let onOpen: (path: string) => void;
let root: string | null = null;
let activePath: string | null = null;
const collapsed = new Set<string>();

export function initSidebar(el: HTMLElement, open: (path: string) => void): void {
  container = el;
  onOpen = open;
  container.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
    if (!item) return;
    if (item.dataset.dir) {
      const p = item.dataset.path!;
      if (collapsed.has(p)) collapsed.delete(p);
      else collapsed.add(p);
      item.parentElement!.classList.toggle("collapsed");
    } else {
      onOpen(item.dataset.path!);
    }
  });
}

export function getRoot(): string | null {
  return root;
}

function renderNodes(nodes: TreeNode[], depth: number): HTMLElement {
  const ul = document.createElement("ul");
  for (const n of nodes) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = n.is_dir ? "tree-row tree-dir" : "tree-row tree-file";
    row.dataset.path = n.path;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.title = n.path;
    if (n.is_dir) {
      row.dataset.dir = "1";
      row.innerHTML = `<span class="chev">▾</span><span class="ico">📁</span>`;
      if (collapsed.has(n.path)) li.classList.add("collapsed");
    } else {
      row.innerHTML = `<span class="ico">${isMermaidFile(n.name) ? "◇" : "📄"}</span>`;
      if (n.path === activePath) row.classList.add("active");
    }
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = n.name;
    row.append(label);
    li.append(row);
    if (n.is_dir) li.append(renderNodes(n.children, depth + 1));
    ul.append(li);
  }
  return ul;
}

export async function loadFolder(path: string | null): Promise<void> {
  root = path;
  await refreshTree();
}

export async function refreshTree(recent: string[] = lastRecent): Promise<void> {
  lastRecent = recent;
  container.replaceChildren();

  if (root) {
    const header = document.createElement("div");
    header.className = "sidebar-header";
    header.innerHTML = `<span class="folder-name"></span><button data-action="refresh-tree" title="Actualizar">⟳</button><button data-action="close-folder" title="Cerrar carpeta">✕</button>`;
    header.querySelector(".folder-name")!.textContent = basename(root) || root;
    header.title = root;
    container.append(header);
    try {
      const nodes = await listDir(root);
      container.append(nodes.length ? renderNodes(nodes, 0) : emptyNote("No hay archivos .md ni .mmd en esta carpeta."));
    } catch (e) {
      container.append(emptyNote(String(e)));
    }
  }

  if (recent.length) {
    const h = document.createElement("div");
    h.className = "sidebar-section";
    h.textContent = "Recientes";
    container.append(h);
    container.append(renderNodes(recent.map((p) => ({ name: basename(p), path: p, is_dir: false, children: [] })), 0));
    container.querySelectorAll<HTMLElement>(".sidebar-section ~ ul .tree-row").forEach((row) => {
      row.title = row.dataset.path!;
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = basename(dirname(row.dataset.path!));
      row.append(hint);
    });
  }

  if (!root && !recent.length) {
    container.append(emptyNote("Abre una carpeta (Ctrl+Mayús+O) para ver sus documentos aquí."));
  }
}

let lastRecent: string[] = [];

function emptyNote(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "sidebar-empty";
  p.textContent = text;
  return p;
}

export function setActiveInTree(path: string | null): void {
  activePath = path;
  container.querySelectorAll(".tree-file.active").forEach((el) => el.classList.remove("active"));
  if (path) {
    container.querySelectorAll<HTMLElement>(".tree-file").forEach((el) => {
      if (el.dataset.path === path) el.classList.add("active");
    });
  }
}
