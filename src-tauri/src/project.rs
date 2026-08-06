use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tar::Archive;
use tauri::Manager;

use crate::commands::approved_path;
use crate::converter;
use crate::is_markdown_path;
use crate::AppState;

#[derive(Serialize, Clone)]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub main: String,
    pub thumbnail: Option<String>,
}

#[derive(Clone, Deserialize)]
struct UniverseTemplateSpec {
    path: String,
    entrypoint: String,
}

#[derive(Clone, Deserialize)]
struct UniversePackage {
    name: String,
    version: String,
    description: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    disciplines: Vec<String>,
    template: Option<UniverseTemplateSpec>,
    #[serde(rename = "updatedAt")]
    updated_at: u64,
}

#[derive(Clone, Serialize)]
pub struct UniverseTemplateInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub category: String,
}

fn extract_universe_template(
    archive_bytes: &[u8],
    template: &UniverseTemplateSpec,
    dest: &Path,
) -> Result<PathBuf, String> {
    let decoder = GzDecoder::new(archive_bytes);
    let mut archive = Archive::new(decoder);
    let template_path = Path::new(&template.path);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let Ok(relative) = path.strip_prefix(template_path) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        if relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(format!("Unsafe archive path: {}", path.display()));
        }
        let output = dest.join(relative);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&output).map_err(|e| e.to_string())?;
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            entry.unpack(&output).map_err(|e| e.to_string())?;
        }
    }

    let main_path = dest.join(&template.entrypoint);
    if !main_path.exists() {
        return Err(format!(
            "Template entrypoint '{}' was not found",
            template.entrypoint
        ));
    }
    Ok(main_path)
}

fn project_dest(parent_path: &str, project_name: &str) -> Result<PathBuf, String> {
    let name_path = Path::new(project_name);
    if project_name.trim().is_empty()
        || name_path.components().count() != 1
        || !matches!(name_path.components().next(), Some(Component::Normal(_)))
    {
        return Err("Project name must be a single folder name".to_string());
    }
    Ok(Path::new(parent_path).join(project_name))
}

fn templates_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        let source_templates = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("templates");
        if source_templates.exists() {
            return source_templates;
        }
    }

    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("resources").join("templates");
        if p.exists() {
            return p;
        }
        let p2 = res.join("templates");
        if p2.exists() {
            return p2;
        }
    }
    std::env::current_dir()
        .unwrap_or_default()
        .join("resources")
        .join("templates")
}

#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let dir = templates_dir(&app);
    let mut templates = Vec::new();
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("cannot read templates dir {dir:?}: {e}"))?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let manifest = entry.path().join("template.json");
        if !manifest.exists() {
            continue;
        }
        let raw = fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        templates.push(TemplateInfo {
            id: v["id"].as_str().unwrap_or("").to_string(),
            name: v["name"].as_str().unwrap_or("").to_string(),
            description: v["description"].as_str().unwrap_or("").to_string(),
            category: v["category"].as_str().unwrap_or("").to_string(),
            main: v["main"].as_str().unwrap_or("main.md").to_string(),
            thumbnail: fs::read(entry.path().join("thumbnail.png"))
                .ok()
                .map(|bytes| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes))),
        });
    }
    templates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(templates)
}

#[tauri::command]
pub async fn list_universe_templates() -> Result<Vec<UniverseTemplateInfo>, String> {
    let packages = reqwest::get("https://packages.typst.org/preview/index.json")
        .await
        .map_err(|e| format!("Failed to fetch Typst Universe: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Typst Universe returned an error: {e}"))?
        .json::<Vec<UniversePackage>>()
        .await
        .map_err(|e| format!("Failed to read Typst Universe package index: {e}"))?;

    let mut latest = std::collections::HashMap::<String, UniversePackage>::new();
    for package in packages
        .into_iter()
        .filter(|package| package.template.is_some())
    {
        let replace = latest
            .get(&package.name)
            .map(|current| package.updated_at > current.updated_at)
            .unwrap_or(true);
        if replace {
            latest.insert(package.name.clone(), package);
        }
    }

    let mut templates = latest
        .into_values()
        .map(|package| UniverseTemplateInfo {
            id: package.name.clone(),
            name: package.name,
            version: package.version,
            description: package.description,
            category: package
                .disciplines
                .first()
                .or_else(|| package.categories.first())
                .cloned()
                .unwrap_or_else(|| "template".to_string()),
        })
        .collect::<Vec<_>>();
    templates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(templates)
}

#[tauri::command]
pub async fn create_project_from_universe_template(
    package_name: String,
    version: String,
    parent_path: String,
    project_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let parent_path = approved_path(&state, &parent_path)?;
    let packages = reqwest::get("https://packages.typst.org/preview/index.json")
        .await
        .map_err(|e| format!("Failed to fetch Typst Universe: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Typst Universe returned an error: {e}"))?
        .json::<Vec<UniversePackage>>()
        .await
        .map_err(|e| format!("Failed to read Typst Universe package index: {e}"))?;
    let package = packages
        .into_iter()
        .find(|package| package.name == package_name && package.version == version)
        .ok_or_else(|| format!("Template @{package_name}:{version} is not in Typst Universe"))?;
    let template = package
        .template
        .ok_or_else(|| format!("@{package_name}:{version} is not a template package"))?;

    let archive_url = format!("https://packages.typst.org/preview/{package_name}-{version}.tar.gz");
    let archive_bytes = reqwest::get(&archive_url)
        .await
        .map_err(|e| format!("Failed to download @{package_name}:{version}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Typst Universe returned an error: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read @{package_name}:{version}: {e}"))?;

    let dest = project_dest(&parent_path.to_string_lossy(), &project_name)?;
    if dest.exists() {
        return Err(format!("Folder '{}' already exists", dest.display()));
    }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let result = extract_universe_template(archive_bytes.as_ref(), &template, &dest)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to import @{package_name}:{version}: {e}"));

    if result.is_err() {
        let _ = fs::remove_dir_all(&dest);
    }
    result
}

#[tauri::command]
pub fn create_project_from_template(
    app: tauri::AppHandle,
    template_id: String,
    parent_path: String,
    project_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let src = templates_dir(&app).join(&template_id);
    if !src.exists() {
        return Err(format!("template '{template_id}' not found"));
    }
    let parent_path = approved_path(&state, &parent_path)?;
    let dest = project_dest(&parent_path.to_string_lossy(), &project_name)?;
    if dest.exists() {
        return Err(format!("Folder '{}' already exists", dest.display()));
    }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let manifest_raw = fs::read_to_string(src.join("template.json")).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_raw).map_err(|e| e.to_string())?;
    let main_file = manifest["main"].as_str().unwrap_or("main.md").to_string();

    for entry in fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "template.json" {
            continue;
        }
        fs::copy(entry.path(), dest.join(&name)).map_err(|e| e.to_string())?;
    }

    let main_path = dest.join(&main_file);
    if is_markdown_path(Path::new(&main_file)) {
        if let Ok(md_content) = fs::read_to_string(&main_path) {
            let (_, fm_yaml) = converter::strip_front_matter(&md_content);
            let has_compile = fm_yaml
                .map(converter::parse_front_matter)
                .and_then(|fm| fm.compile)
                .is_some();
            if has_compile {
                let (body_typst, _) = converter::markdown_to_typst(&md_content);
                let stem = Path::new(&main_file)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "content".to_string());
                let _ = fs::write(dest.join(format!("{stem}.typ")), body_typst);
            }
        }
    }

    Ok(main_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::fs;
    use tar::{Builder, Header};

    fn template_archive(files: &[(&str, &str)]) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut archive = Builder::new(encoder);
        for (path, content) in files {
            let mut header = Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, path, content.as_bytes())
                .unwrap();
        }
        archive.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn extract_universe_template_copies_declared_subtree_only() {
        let dir = std::env::temp_dir().join("ts_universe_extract");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = template_archive(&[
            ("README.md", "package docs"),
            ("template/main.typ", "= Hello"),
            ("template/assets/logo.txt", "logo"),
        ]);
        let template = UniverseTemplateSpec {
            path: "template".to_string(),
            entrypoint: "main.typ".to_string(),
        };

        let main = extract_universe_template(&archive, &template, &dir).unwrap();

        assert_eq!(main, dir.join("main.typ"));
        assert_eq!(fs::read_to_string(dir.join("main.typ")).unwrap(), "= Hello");
        assert_eq!(
            fs::read_to_string(dir.join("assets/logo.txt")).unwrap(),
            "logo"
        );
        assert!(!dir.join("README.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_universe_template_requires_declared_entrypoint() {
        let dir = std::env::temp_dir().join("ts_universe_missing_entrypoint");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = template_archive(&[("template/other.typ", "= Other")]);
        let template = UniverseTemplateSpec {
            path: "template".to_string(),
            entrypoint: "main.typ".to_string(),
        };

        let error = extract_universe_template(&archive, &template, &dir).unwrap_err();

        assert!(error.contains("Template entrypoint 'main.typ' was not found"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_dest_rejects_nested_paths() {
        assert!(project_dest("/tmp", "../outside").is_err());
        assert!(project_dest("/tmp", "nested/project").is_err());
        assert_eq!(
            project_dest("/tmp", "paper").unwrap(),
            Path::new("/tmp").join("paper")
        );
    }
}
