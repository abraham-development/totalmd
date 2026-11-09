//! Actualizaciones desde GitHub Releases (tauri-plugin-updater).
//!
//! La comprobación y la instalación van por comandos propios para poder
//! sustituir el endpoint en pruebas (TOTALMD_UPDATE_ENDPOINT) y reintentar los
//! fallos temporales de GitHub (p. ej. 504). La firma se verifica siempre con
//! la clave pública de tauri.conf.json.

use serde::Serialize;
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

/// Intentos ante errores de red: GitHub devuelve a veces 504 durante unos segundos.
const ATTEMPTS: u32 = 3;

/// Actualización encontrada por `check_update`, pendiente de instalar.
/// Se conserva si la instalación falla, para poder reintentar.
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

/// Ejecuta `op` hasta ATTEMPTS veces, esperando 2 s, 4 s… entre intentos.
async fn with_retries<T, F, Fut>(mut op: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut attempt = 1;
    loop {
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) if attempt < ATTEMPTS => {
                eprintln!("[updater] intento {attempt} fallido: {e}");
                tokio::time::sleep(Duration::from_secs(2 * u64::from(attempt))).await;
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

async fn find_update(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = builder(app)?.build().map_err(|e| e.to_string())?;
    with_retries(|| {
        let updater = &updater;
        async move { updater.check().await.map_err(|e| e.to_string()) }
    })
    .await
}

#[tauri::command]
pub async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let update = find_update(&app).await?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// Descarga (con reintentos), verifica la firma e instala el .deb con pkexec.
#[tauri::command]
pub async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let stored = pending.0.lock().map_err(|e| e.to_string())?.clone();
    let update = match stored {
        Some(u) => u,
        None => find_update(&app).await?.ok_or("Ya tienes la última versión")?,
    };

    let bytes = with_retries(|| {
        let (app, update) = (&app, &update);
        async move {
            let mut downloaded = 0u64;
            update
                .download(
                    |chunk, total| {
                        downloaded += chunk as u64;
                        let _ = app.emit("update-progress", Progress { downloaded, total });
                    },
                    || {},
                )
                .await
                .map_err(|e| e.to_string())
        }
    })
    .await?;

    // La instalación no se reintenta: si falla (p. ej. contraseña cancelada) lo decide el usuario.
    update.install(bytes).map_err(|e| e.to_string())?;
    *pending.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
