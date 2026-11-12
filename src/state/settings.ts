// Preferencias persistentes (plugin-store en Tauri; localStorage en navegador).
import { load, type Store } from "@tauri-apps/plugin-store";
import { isTauri } from "../api";

export type ThemePref = "system" | "light" | "dark";
export type Mode = "view" | "edit" | "split";

export interface Settings {
  theme: ThemePref;
  zoom: number;
  sidebar: boolean;
  folder: string | null;
  recent: string[];
  session: string[];
  activeSession: string | null;
  splitRatio: number;
  syncScroll: boolean;
}

const DEFAULTS: Settings = {
  theme: "system",
  zoom: 1,
  sidebar: true,
  folder: null,
  recent: [],
  session: [],
  activeSession: null,
  splitRatio: 0.5,
  syncScroll: true,
};

let store: Store | null = null;
export const settings: Settings = { ...DEFAULTS };

export async function loadSettings(): Promise<void> {
  try {
    if (isTauri) {
      store = await load("settings.json", { autoSave: 400, defaults: {} });
      for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        const v = await store.get(key);
        if (v !== undefined && v !== null) (settings as unknown as Record<string, unknown>)[key] = v;
      }
    } else {
      Object.assign(settings, JSON.parse(localStorage.getItem("totalmd") ?? "{}"));
    }
  } catch {
    /* preferencias corruptas: se usan las de fábrica */
  }
}

export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  if (store) void store.set(key, value);
  else {
    try {
      localStorage.setItem("totalmd", JSON.stringify(settings));
    } catch {
      /* sin almacenamiento disponible */
    }
  }
}

export function addRecent(path: string): void {
  saveSetting("recent", [path, ...settings.recent.filter((p) => p !== path)].slice(0, 12));
}

/** Quita un archivo de Recientes (no lo borra del disco). */
export function removeRecent(path: string): void {
  saveSetting("recent", settings.recent.filter((p) => p !== path));
}

export function clearRecent(): void {
  saveSetting("recent", []);
}
