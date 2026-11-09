//! Comandos de sistema de archivos expuestos al frontend.

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Extensiones que la aplicación considera documentos.
const DOC_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mmd", "mermaid"];
/// Carpetas que nunca se recorren en el árbol lateral.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__", "venv"];
const MAX_DEPTH: usize = 12;
const MAX_ENTRIES: usize = 20_000;

#[derive(Serialize)]
pub struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

#[derive(Serialize)]
pub struct FileStat {
    exists: bool,
    is_dir: bool,
    size: u64,
    mtime_ms: u64,
}

pub fn is_doc(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DOC_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn err<E: std::fmt::Display>(path: &str) -> impl FnOnce(E) -> String + '_ {
    move |e| format!("{path}: {e}")
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(err(&path))?;
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    })
}

/// Escritura atómica: escribe en un temporal junto al destino y lo renombra,
/// así un corte de luz o un error nunca deja el archivo a medias.
fn write_atomic(path: &str, data: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target.file_name().ok_or_else(|| format!("{path}: ruta inválida"))?;
    let tmp: PathBuf = dir.join(format!(".{}.totalmd-tmp", name.to_string_lossy()));

    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        if let Ok(meta) = fs::metadata(target) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, target)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(err(path))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    write_atomic(&path, content.as_bytes())
}

#[tauri::command]
pub fn write_binary(path: String, base64: String) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(err(&path))?;
    write_atomic(&path, &data)
}

#[tauri::command]
pub fn stat_file(path: String) -> FileStat {
    match fs::metadata(&path) {
        Ok(m) => FileStat {
            exists: true,
            is_dir: m.is_dir(),
            size: m.len(),
            mtime_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        },
        Err(_) => FileStat { exists: false, is_dir: false, size: 0, mtime_ms: 0 },
    }
}

fn walk(dir: &Path, depth: usize, budget: &mut usize) -> Vec<TreeNode> {
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut entries: Vec<_> = read.flatten().collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());

    let (mut dirs, mut files) = (Vec::new(), Vec::new());
    for entry in entries {
        if *budget == 0 {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        // file_type() no sigue enlaces simbólicos: evita ciclos infinitos.
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if depth >= MAX_DEPTH || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let children = walk(&path, depth + 1, budget);
            // Solo se muestran carpetas que contienen documentos.
            if !children.is_empty() {
                dirs.push(TreeNode { name, path: path.to_string_lossy().into_owned(), is_dir: true, children });
            }
        } else if (ft.is_file() || ft.is_symlink()) && is_doc(&path) {
            *budget -= 1;
            files.push(TreeNode { name, path: path.to_string_lossy().into_owned(), is_dir: false, children: Vec::new() });
        }
    }
    dirs.extend(files);
    dirs
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<TreeNode>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("{path}: no es una carpeta"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut budget = MAX_ENTRIES;
        walk(&root, 0, &mut budget)
    })
    .await
    .map_err(|e| e.to_string())
}
