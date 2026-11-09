// Actualizaciones: aviso en una barra, descarga con progreso, instalación y reinicio.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri, log } from "./api";
import { toast } from "./ui/dialogs";

interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

let confirmUnsaved: () => Promise<boolean>;
let installing = false;

const bar = () => document.getElementById("update-bar")!;
const text = () => document.getElementById("update-text")!;

/** `beforeInstall` debe resolver false si el usuario cancela (p. ej. cambios sin guardar). */
export async function initUpdater(beforeInstall: () => Promise<boolean>): Promise<void> {
  confirmUnsaved = beforeInstall;
  if (!isTauri) return;
  const item = document.querySelector<HTMLElement>('[data-action="check-update"]');
  if (item) item.textContent = `Buscar actualizaciones (v${await getVersion()})`;
  await listen<{ downloaded: number; total: number | null }>("update-progress", ({ payload }) => {
    const mb = (n: number) => (n / 1_048_576).toFixed(1);
    text().textContent = payload.total
      ? `Descargando actualización… ${Math.round((payload.downloaded / payload.total) * 100)} % (${mb(payload.downloaded)} de ${mb(payload.total)} MB)`
      : `Descargando actualización… ${mb(payload.downloaded)} MB`;
  });
}

/** Busca una versión nueva. En modo silencioso (al arrancar) no informa de errores ni de «sin novedades». */
export async function checkForUpdate(silent: boolean): Promise<void> {
  if (!isTauri || installing) return;
  try {
    const info = await invoke<UpdateInfo | null>("check_update");
    if (info) showAvailable(info);
    else if (!silent) toast("Estás en la última versión");
  } catch (e) {
    log("warn", `actualización: ${e}`);
    if (!silent) toast(`No se pudo buscar actualizaciones: ${e}`, "error");
  }
}

function showAvailable(info: UpdateInfo): void {
  text().textContent = `Hay una versión nueva de TotalMD: ${info.version} (tienes la ${info.current}).`;
  const notes = document.getElementById("update-notes")!;
  notes.textContent = info.notes ? `Novedades: ${info.notes}` : "";
  setButtons(true);
  bar().hidden = false;
}

function setButtons(visible: boolean): void {
  bar().querySelectorAll<HTMLElement>("button").forEach((b) => (b.hidden = !visible));
}

export async function installUpdate(): Promise<void> {
  if (installing || !(await confirmUnsaved())) return;
  installing = true;
  setButtons(false);
  text().textContent = "Descargando actualización…";
  try {
    await invoke("install_update");
    text().textContent = "Actualización instalada. Reiniciando TotalMD…";
    await relaunch();
  } catch (e) {
    installing = false;
    text().textContent = `No se pudo instalar la actualización: ${e}`;
    setButtons(true);
  }
}

export function dismissUpdate(): void {
  bar().hidden = true;
}
