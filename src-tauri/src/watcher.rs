//! Vigilancia de cambios en disco.
//!
//! Los archivos abiertos se vigilan a través de su carpeta (no recursiva):
//! muchos editores guardan con "escribir temporal + renombrar", lo que rompe
//! una vigilancia directa sobre el inodo del archivo. La carpeta abierta en la
//! barra lateral se vigila aparte, de forma recursiva.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
struct FsChange {
    source: &'static str,
    kind: &'static str,
    paths: Vec<String>,
}

pub struct Watchers {
    files: Mutex<(RecommendedWatcher, HashMap<PathBuf, usize>)>,
    tree: Mutex<Option<(RecommendedWatcher, PathBuf)>>,
    app: AppHandle,
}

fn make_watcher(app: AppHandle, source: &'static str) -> notify::Result<RecommendedWatcher> {
    notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        let kind = match ev.kind {
            EventKind::Create(_) => "create",
            EventKind::Remove(_) => "remove",
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => "rename",
            EventKind::Modify(notify::event::ModifyKind::Metadata(_)) => return,
            EventKind::Modify(_) => "modify",
            _ => return,
        };
        let paths: Vec<String> = ev
            .paths
            .iter()
            .filter(|p| !p.to_string_lossy().ends_with(".totalmd-tmp"))
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("fs-change", FsChange { source, kind, paths });
        }
    })
}

impl Watchers {
    pub fn new(app: AppHandle) -> notify::Result<Self> {
        Ok(Self {
            files: Mutex::new((make_watcher(app.clone(), "file")?, HashMap::new())),
            tree: Mutex::new(None),
            app,
        })
    }
}

fn parent_of(path: &str) -> Option<PathBuf> {
    Path::new(path).parent().filter(|p| !p.as_os_str().is_empty()).map(Path::to_path_buf)
}

#[tauri::command]
pub fn watch_file(path: String, state: State<'_, Watchers>) -> Result<(), String> {
    let Some(dir) = parent_of(&path) else { return Ok(()) };
    let mut guard = state.files.lock().map_err(|e| e.to_string())?;
    let (watcher, dirs) = &mut *guard;
    let count = dirs.entry(dir.clone()).or_insert(0);
    if *count == 0 {
        watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    }
    *count += 1;
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(path: String, state: State<'_, Watchers>) -> Result<(), String> {
    let Some(dir) = parent_of(&path) else { return Ok(()) };
    let mut guard = state.files.lock().map_err(|e| e.to_string())?;
    let (watcher, dirs) = &mut *guard;
    if let Some(count) = dirs.get_mut(&dir) {
        *count -= 1;
        if *count == 0 {
            dirs.remove(&dir);
            let _ = watcher.unwatch(&dir);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn watch_tree(path: Option<String>, state: State<'_, Watchers>) -> Result<(), String> {
    let mut tree = state.tree.lock().map_err(|e| e.to_string())?;
    *tree = None; // suelta la vigilancia anterior
    if let Some(path) = path {
        let root = PathBuf::from(path);
        let mut w = make_watcher(state.app.clone(), "tree").map_err(|e| e.to_string())?;
        w.watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
        *tree = Some((w, root));
    }
    Ok(())
}
