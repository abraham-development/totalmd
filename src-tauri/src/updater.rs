//! Actualizaciones desde GitHub Releases (tauri-plugin-updater).
//!
//! La comprobación y la instalación van por comandos propios para poder
//! sustituir el endpoint en pruebas (TOTALMD_UPDATE_ENDPOINT). La firma se
//! verifica siempre con la clave pública de tauri.conf.json.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

/// Actualización encontrada por `check_update`, pendiente de instalar.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn builder(app: &AppHandle) -> Result<UpdaterBuilder, String> {
    let builder = app.updater_builder();
    let Ok(endpoint) = std::env::var("TOTALMD_UPDATE_ENDPOINT") else { return Ok(builder) };
    if endpoint.starts_with("http://") && !endpoint.starts_with("http://127.0.0.1") {
        return Err("TOTALMD_UPDATE_ENDPOINT: solo se permite http:// en 127.0.0.1".into());
    }
    let url = endpoint.parse().map_err(|e| format!("TOTALMD_UPDATE_ENDPOINT: {e}"))?;
    builder.endpoints(vec![url]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let updater = builder(&app)?.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// Descarga, verifica la firma e instala el .deb (con pkexec: pide la contraseña).
#[tauri::command]
pub async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No hay ninguna actualización pendiente")?;
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
}
