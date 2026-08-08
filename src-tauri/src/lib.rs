mod ai;
mod commands;
mod compile_actor;
mod converter;
mod latex_import;
mod lsp_bridge;
mod menu;
mod path_policy;
mod preview_sidecar;
mod project;
mod snapshots;
mod typst_world;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Clone)]
pub struct CompileRequest {
    pub path: String,
    pub content: String,
    pub sidecar: Option<(String, String)>,
}

pub struct AppState {
    pub tinymist_path: Mutex<String>,
    pub compile_tx: tokio::sync::watch::Sender<Option<CompileRequest>>,
    pub typst_world: Arc<Mutex<Option<typst_world::TypstWorld>>>,
    pub preview_sidecar: preview_sidecar::SharedSidecar,
    pub path_policy: Mutex<path_policy::PathPolicy>,
}

pub(crate) fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("md") | Some("markdown")
    )
}

fn find_tinymist_path(resource_dir: &str) -> String {
    let target_triple = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else {
        "x86_64-unknown-linux-gnu"
    };

    let candidates = vec![
        format!("{resource_dir}/binaries/tinymist-{target_triple}"),
        format!(
            "{}/binaries/tinymist-{target_triple}",
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
        ),
        "tinymist".to_string(),
    ];

    candidates
        .into_iter()
        .find(|p| Path::new(p).exists())
        .unwrap_or_else(|| "tinymist".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_tinymist_path_falls_back_to_tinymist_string() {
        let path = find_tinymist_path("/nonexistent/resource/dir");
        assert!(path.ends_with("tinymist") || path.contains("tinymist"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let world_arc = Arc::new(Mutex::new(None));
    let (compile_tx, compile_rx) = tokio::sync::watch::channel::<Option<CompileRequest>>(None);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ai::AiCancelFlag::default())
        .manage(AppState {
            tinymist_path: Mutex::new(String::new()),
            compile_tx,
            typst_world: Arc::clone(&world_arc),
            preview_sidecar: Arc::new(tokio::sync::Mutex::new(
                preview_sidecar::PreviewSidecar::default(),
            )),
            path_policy: Mutex::new(path_policy::PathPolicy::default()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_workspace_root,
            commands::approve_path,
            commands::file_stat,
            commands::read_file,
            commands::read_file_bytes,
            commands::write_file,
            commands::write_file_bytes,
            commands::create_file,
            commands::create_temp_file,
            commands::create_dir,
            commands::list_dir,
            commands::search_in_files,
            compile_actor::update_preview_source,
            compile_actor::trigger_preview_compile,
            compile_actor::start_sidecar_preview,
            compile_actor::stop_sidecar_preview,
            compile_actor::write_preview_sidecar_content,
            compile_actor::validate_preview_sidecar_content,
            compile_actor::export_pdf,
            snapshots::save_snapshot,
            snapshots::list_snapshots,
            commands::path_exists,
            commands::show_move_conflict_dialog,
            commands::rename_path,
            commands::copy_path,
            commands::delete_path,
            commands::reveal_in_finder,
            commands::convert_to_typst,
            commands::fetch_doi,
            latex_import::import_latex_template,
            commands::read_settings,
            commands::write_settings,
            commands::read_workspace_sessions,
            commands::write_workspace_sessions,
            ai::check_claude_cli,
            ai::check_codex_cli,
            ai::get_codex_cli_version,
            ai::list_codex_models,
            ai::stream_claude_cli,
            ai::stream_codex_cli,
            ai::stream_ai_chat,
            ai::stream_ai_chat_with_tools,
            ai::stream_claude_api,
            ai::cancel_ai_stream,
            ai::search_citations,
            ai::list_ollama_models,
            project::list_templates,
            project::list_universe_templates,
            project::create_project_from_template,
            project::create_project_from_universe_template,
        ])
        .setup(move |app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("resource dir")
                .to_string_lossy()
                .to_string();

            let tinymist_path = find_tinymist_path(&resource_dir);
            eprintln!("[setup] Using tinymist at: {tinymist_path}");

            *app.state::<AppState>().tinymist_path.lock().unwrap() = tinymist_path.clone();

            menu::build_menu(app)?;

            if let Ok(settings_str) =
                fs::read_to_string(commands::settings_file_path(app.handle())?)
            {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&settings_str) {
                    if v.get("aiProvider").and_then(|p| p.as_str()) == Some("ollama") {
                        let url = v
                            .get("ollamaUrl")
                            .and_then(|u| u.as_str())
                            .unwrap_or("http://localhost:11434")
                            .to_string();
                        tauri::async_runtime::spawn(async move {
                            if let Some(_child) = ai::ensure_ollama_server(url).await {
                                tokio::signal::ctrl_c().await.ok();
                            }
                        });
                    }
                }
            }

            tauri::async_runtime::spawn(compile_actor::compile_actor(
                compile_rx,
                world_arc,
                app.handle().clone(),
            ));

            tauri::async_runtime::spawn(lsp_bridge::run_lsp_bridge(tinymist_path));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
