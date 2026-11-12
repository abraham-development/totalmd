// Capa de acceso al backend de Tauri. Si la interfaz se abre en un navegador
// normal (pnpm dev sin Tauri), usa alternativas mínimas para poder probarla.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export const isTauri = "__TAURI_INTERNALS__" in window;

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[];
}

export interface FileStat {
  exists: boolean;
  is_dir: boolean;
  size: number;
  mtime_ms: number;
}

export interface FsChange {
  source: "file" | "tree";
  kind: "create" | "remove" | "rename" | "modify";
  paths: string[];
}

export async function readFile(path: string): Promise<string> {
  if (!isTauri) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  }
  return invoke<string>("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (!isTauri) throw new Error("Guardar solo está disponible en la app de escritorio");
  await invoke("write_file", { path, content });
}

export async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri) throw new Error("Guardar solo está disponible en la app de escritorio");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  await invoke("write_binary", { path, base64: btoa(bin) });
}

export async function statFile(path: string): Promise<FileStat> {
  if (!isTauri) return { exists: true, is_dir: false, size: 0, mtime_ms: 0 };
  return invoke<FileStat>("stat_file", { path });
}

export async function listDir(path: string): Promise<TreeNode[]> {
  if (!isTauri) return [];
  return invoke<TreeNode[]>("list_dir", { path });
}

export async function watchFile(path: string): Promise<void> {
  if (isTauri) await invoke("watch_file", { path }).catch(() => {});
}

export async function unwatchFile(path: string): Promise<void> {
  if (isTauri) await invoke("unwatch_file", { path }).catch(() => {});
}

export async function watchTree(path: string | null): Promise<void> {
  if (isTauri) await invoke("watch_tree", { path }).catch(() => {});
}

export async function takeStartupFiles(): Promise<string[]> {
  if (!isTauri) return [];
  return invoke<string[]>("take_startup_files");
}

export async function isSelftest(): Promise<boolean> {
  if (!isTauri) return new URLSearchParams(location.search).has("selftest");
  return invoke<boolean>("is_selftest");
}

export function log(level: "info" | "warn" | "error", message: string): void {
  if (isTauri) void invoke("log_message", { level, message }).catch(() => {});
  else console[level](message);
}

export async function exitApp(code: number): Promise<void> {
  if (isTauri) await invoke("exit_app", { code });
}

/** Ejecuta `xdg-mime default` y devuelve el nombre del lanzador registrado. */
export async function setAsDefaultApp(): Promise<string> {
  if (!isTauri) throw new Error("Solo disponible en la app de escritorio");
  return invoke<string>("set_as_default_app");
}

/** Captura de la vista web a PNG (solo si la app se lanzó con TOTALMD_SNAPSHOT_DIR). */
export interface PrintResult {
  done: boolean;
  pages: number | null;
}

/** Con ruta: exporta el documento a PDF (A4) sin diálogo. Sin ruta: abre el diálogo de impresión. */
export async function printDocument(pdfPath?: string): Promise<PrintResult> {
  if (!isTauri) {
    window.print();
    return { done: true, pages: null };
  }
  return invoke<PrintResult>("print_document", { pdfPath: pdfPath ?? null });
}

/** Carpeta de capturas de la autoprueba (TOTALMD_SNAPSHOT_DIR), si está definida. */
export async function snapshotDir(): Promise<string | null> {
  return isTauri ? invoke<string | null>("snapshot_dir") : null;
}

export async function snapshot(name: string): Promise<void> {
  if (isTauri) await invoke("debug_snapshot", { name }).catch(() => {});
}

/** URL que el webview puede cargar para un archivo local (imágenes). */
export function fileUrl(path: string): string {
  return isTauri ? convertFileSrc(path) : path;
}
