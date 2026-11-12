mod fs_cmds;
mod print;
mod updater;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Archivos recibidos por línea de comandos al arrancar (p. ej. doble clic en Nautilus).
struct Startup {
    files: Mutex<Vec<String>>,
    selftest: bool,
}

/// Convierte los argumentos de lanzamiento en rutas absolutas de archivos existentes.
fn collect_files(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let raw = a.strip_prefix("file://").map(percent_decode).unwrap_or_else(|| a.clone());
            let p = PathBuf::from(raw);
            let abs = if p.is_absolute() { p } else { cwd.join(p) };
            abs.canonicalize().unwrap_or(abs)
        })
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn take_startup_files(state: tauri::State<'_, Startup>) -> Vec<String> {
    std::mem::take(&mut *state.files.lock().unwrap())
}

#[tauri::command]
fn is_selftest(state: tauri::State<'_, Startup>) -> bool {
    state.selftest
}

/// Reenvía mensajes del frontend a la salida estándar (útil para depurar).
#[tauri::command]
fn log_message(level: String, message: String) {
    println!("[frontend:{level}] {message}");
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

/// Busca el lanzador .desktop instalado cuyo Exec apunta a este programa.
fn find_desktop_file() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{home}/.local/share"));
    let dirs = [format!("{data_home}/applications"), "/usr/local/share/applications".into(), "/usr/share/applications".into()];
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".desktop") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            let is_ours = text.lines().any(|l| {
                l.strip_prefix("Exec=")
                    .and_then(|cmd| cmd.split_whitespace().next())
                    .map(|bin| Path::new(bin).file_name().is_some_and(|f| f == "totalmd"))
                    .unwrap_or(false)
            });
            if is_ours {
                return Some(name);
            }
        }
    }
    None
}

/// Registra TotalMD como aplicación predeterminada para Markdown y Mermaid.
#[tauri::command]
fn set_as_default_app() -> Result<String, String> {
    let desktop = find_desktop_file()
        .ok_or("No se encontró el lanzador de TotalMD. Instala primero el paquete .deb.")?;
    let status = std::process::Command::new("xdg-mime")
        .args(["default", &desktop, "text/markdown", "text/x-markdown", "text/x-mermaid"])
        .status()
        .map_err(|e| format!("xdg-mime: {e}"))?;
    if status.success() {
        Ok(desktop)
    } else {
        Err(format!("xdg-mime terminó con {status}"))
    }
}

/// Diagnóstico inyectado con TOTALMD_DEBUG=1: informa errores y el estado de la página.
const DEBUG_PROBE: &str = r#"
(() => {
  const send = (m) => window.__TAURI_INTERNALS__.invoke('log_message', { level: 'probe', message: String(m) });
  window.addEventListener('error', (e) => send('error: ' + e.message + ' @ ' + e.filename + ':' + e.lineno), true);
  window.addEventListener('unhandledrejection', (e) => send('rejection: ' + (e.reason && e.reason.stack || e.reason)));
  document.addEventListener('securitypolicyviolation', (e) => send('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));
  send('probe ok, readyState=' + document.readyState + ' scripts=' + document.scripts.length);
  setTimeout(() => send('3s: title=' + document.title + ' tabs=' + document.querySelectorAll('.tab').length + ' preview=' + (document.getElementById('preview') || {}).childElementCount), 3000);
})();
"#;

/// Captura PNG de la vista web (solo con TOTALMD_SNAPSHOT_DIR, para pruebas visuales).
/// Carpeta de capturas de la autoprueba (TOTALMD_SNAPSHOT_DIR).
#[tauri::command]
fn snapshot_dir() -> Option<String> {
    std::env::var("TOTALMD_SNAPSHOT_DIR").ok()
}

#[tauri::command]
fn debug_snapshot(window: tauri::WebviewWindow, name: String) -> Result<(), String> {
    let Some(dir) = std::env::var_os("TOTALMD_SNAPSHOT_DIR") else { return Ok(()) };
    let path = PathBuf::from(dir).join(format!("{name}.png"));
    #[cfg(target_os = "linux")]
    window
        .with_webview(move |wv| {
            use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
            wv.inner().snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&gio::Cancellable>, move |res| {
                let saved = res
                    .map_err(|e| e.to_string())
                    .and_then(|surface| cairo::ImageSurface::try_from(surface).map_err(|_| "superficie no válida".to_string()))
                    .and_then(|img| {
                        let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
                        img.write_to_png(&mut f).map_err(|e| e.to_string())
                    });
                match saved {
                    Ok(()) => println!("[snapshot] {}", path.display()),
                    Err(e) => println!("[snapshot] error: {e}"),
                }
            });
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup = Startup {
        files: Mutex::new(collect_files(&args, &cwd)),
        selftest: args.iter().any(|a| a == "--selftest"),
    };

    let mut builder = tauri::Builder::default();
    // La autoprueba corre aparte aunque el usuario tenga TotalMD abierta.
    if !startup.selftest {
        // Debe registrarse primero: un segundo lanzamiento entrega sus archivos a esta ventana.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = collect_files(&argv, Path::new(&cwd));
            let _ = app.emit("open-files", files);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(startup)
        .manage(updater::PendingUpdate::default())
        .on_page_load(|webview, payload| {
            if std::env::var_os("TOTALMD_DEBUG").is_some() {
                eprintln!("[page] {:?} {}", payload.event(), payload.url());
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    let _ = webview.eval(DEBUG_PROBE);
                }
            }
        })
        .setup(|app| {
            if std::env::var_os("TOTALMD_DEBUG").is_some() {
                eprintln!("[setup] inicio");
            }
            app.manage(watcher::Watchers::new(app.handle().clone())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_startup_files,
            is_selftest,
            log_message,
            exit_app,
            set_as_default_app,
            debug_snapshot,
            snapshot_dir,
            print::print_document,
            updater::check_update,
            updater::install_update,
            fs_cmds::read_file,
            fs_cmds::write_file,
            fs_cmds::write_binary,
            fs_cmds::stat_file,
            fs_cmds::list_dir,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::watch_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar TotalMD");
}
