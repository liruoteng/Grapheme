use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

use crate::converter;

#[derive(Serialize)]
pub struct FileStat {
    pub mtime: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub line_content: String,
}

#[tauri::command]
pub fn file_stat(path: String) -> Result<FileStat, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string());
    meta.and_then(|m| {
        m.modified()
            .map(|t| FileStat {
                mtime: t
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            })
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&path, contents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("Destination already exists: {path}"));
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_temp_file(extension: Option<String>) -> Result<String, String> {
    let ext = extension.unwrap_or_else(|| "typ".to_string());
    let ext = ext
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.')
        .take(16)
        .collect::<String>();
    if ext.is_empty() || ext.contains("..") || ext.starts_with('.') {
        return Err("invalid extension".into());
    }
    let dir = std::env::temp_dir().join("type-studio");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for n in 1..10000 {
        let candidate = dir.join(format!("untitled-{n}.{ext}"));
        if !candidate.exists() {
            fs::write(&candidate, "").map_err(|e| e.to_string())?;
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    Err("could not allocate temp filename".into())
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let read = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries: Vec<FileEntry> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            Some(FileEntry {
                name,
                path: e.path().to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
            })
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn search_in_files(root_dir: String, query: String) -> Result<Vec<SearchMatch>, String> {
    let mut results = Vec::new();
    let root = Path::new(&root_dir);
    if !root.is_dir() {
        return Err("Not a directory".to_string());
    }
    let query_lower = query.to_lowercase();
    search_dir(root, root, &query_lower, &mut results)?;
    Ok(results)
}

fn search_dir(
    _base: &Path,
    dir: &Path,
    query: &str,
    results: &mut Vec<SearchMatch>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if let Some(name) = path.file_name() {
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir()
                && (name.as_ref() == "node_modules"
                    || name.as_ref() == "target"
                    || name.as_ref() == ".history")
            {
                continue;
            }
        }

        if path.is_dir() {
            let _ = search_dir(_base, &path, query, results);
        } else if path.is_file() {
            if let Ok(meta) = path.metadata() {
                if meta.len() > 1_048_576 {
                    continue;
                }
            }
            if let Ok(content) = fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(query) {
                        let line_content = if line.len() > 200 {
                            format!("{}…", &line[..200])
                        } else {
                            line.to_string()
                        };
                        results.push(SearchMatch {
                            path: path.to_string_lossy().to_string(),
                            line: i + 1,
                            line_content,
                        });
                        if results.len() >= 200 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn show_move_conflict_dialog(src_name: String, dest_dir_name: String) -> String {
    let safe_src = src_name.replace('\\', "\\\\").replace('"', "\\\"");
    let safe_dest = dest_dir_name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display dialog \"\\\"{}\\\" already exists in \\\"{}\\\". \
         What would you like to do?\" \
         with title \"File Already Exists\" \
         buttons {{\"Stop\", \"Keep Both\", \"Replace\"}} \
         default button \"Keep Both\" \
         cancel button \"Stop\" \
         with icon caution",
        safe_src, safe_dest
    );
    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.trim()
                .strip_prefix("button returned:")
                .unwrap_or("Stop")
                .to_string()
        }
        Err(_) => "Stop".to_string(),
    }
}

#[tauri::command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&src_child, &dst_child)?;
        } else {
            fs::copy(&src_child, &dst_child)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_path(src: String, dest: String) -> Result<(), String> {
    let s = Path::new(&src);
    let d = Path::new(&dest);
    if d.exists() {
        return Err(format!("Destination already exists: {dest}"));
    }
    if s.is_dir() {
        copy_dir_recursive(s, d).map_err(|e| e.to_string())
    } else {
        fs::copy(s, d).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(crate) fn settings_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
    let p = settings_file_path(&app)?;
    if !p.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let p = settings_file_path(&app)?;
    fs::write(&p, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn convert_to_typst(path: String) -> Result<String, String> {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "md" | "markdown" => {
            if let Ok(result) = converter::try_pandoc("markdown", &path) {
                Ok(result)
            } else {
                let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                Ok(converter::markdown_to_typst(&content).0)
            }
        }
        "docx" => converter::try_pandoc("docx", &path),
        "pdf" => converter::try_pdf_to_typst(&path),
        other => Err(format!("Unsupported format: .{other}")),
    }
}

#[tauri::command]
pub async fn fetch_doi(doi: String) -> Result<serde_json::Value, String> {
    let url = format!("https://api.crossref.org/works/{doi}");
    let client = reqwest::Client::builder()
        .user_agent("Grapheme/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("DOI not found (status {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let msg = &json["message"];

    let title = msg["title"][0].as_str().unwrap_or("").to_string();
    let year = msg["published"]["date-parts"][0][0].as_u64().unwrap_or(0) as u32;
    let doi_str = msg["DOI"].as_str().unwrap_or(&doi).to_string();
    let venue = msg["container-title"][0].as_str().unwrap_or("").to_string();

    let authors: Vec<String> = msg["author"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|a| {
            let given = a["given"].as_str().unwrap_or("");
            let family = a["family"].as_str().unwrap_or("");
            if given.is_empty() {
                family.to_string()
            } else {
                format!("{family}, {given}")
            }
        })
        .collect();

    let first_family = msg["author"][0]["family"].as_str().unwrap_or("unknown");
    let bib_key = format!(
        "{}{}",
        first_family
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>(),
        year
    );

    Ok(serde_json::json!({
        "bibKey": bib_key,
        "title": title,
        "authors": authors,
        "year": year,
        "doi": doi_str,
        "venue": venue,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dir_sorts_dirs_before_files_then_alphabetically() {
        let dir = std::env::temp_dir().join("ts_listdir_sort");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("b.typ"), "").unwrap();
        fs::write(dir.join("a.typ"), "").unwrap();
        fs::create_dir_all(dir.join("zdir")).unwrap();
        fs::create_dir_all(dir.join("adir")).unwrap();

        let entries = list_dir(dir.to_string_lossy().to_string()).unwrap();

        assert_eq!(entries.len(), 4);
        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
        assert!(!entries[3].is_dir);
        assert_eq!(entries[0].name, "adir");
        assert_eq!(entries[1].name, "zdir");
        assert_eq!(entries[2].name, "a.typ");
        assert_eq!(entries[3].name, "b.typ");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_dir_excludes_hidden_files() {
        let dir = std::env::temp_dir().join("ts_listdir_hidden");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("visible.typ"), "").unwrap();
        fs::write(dir.join(".hidden"), "").unwrap();
        fs::create_dir_all(dir.join(".hiddendir")).unwrap();

        let entries = list_dir(dir.to_string_lossy().to_string()).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.typ");

        let _ = fs::remove_dir_all(&dir);
    }
}
