use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

pub fn build_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    let m_new_file = MenuItemBuilder::new("New Typst Document")
        .id("new-file")
        .accelerator("CmdOrCtrl+N")
        .build(handle)?;
    let m_new_md = MenuItemBuilder::new("New Markdown Document")
        .id("new-file-md")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(handle)?;
    let m_new_template = MenuItemBuilder::new("New Project from Template…")
        .id("new-from-template")
        .build(handle)?;
    let m_open_file = MenuItemBuilder::new("Open File…")
        .id("open-file")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let m_open_folder = MenuItemBuilder::new("Open Folder…")
        .id("open-folder")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(handle)?;
    let m_save = MenuItemBuilder::new("Save")
        .id("save")
        .accelerator("CmdOrCtrl+S")
        .build(handle)?;
    let m_save_all = MenuItemBuilder::new("Save All")
        .id("save-all")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(handle)?;
    let m_close_tab = MenuItemBuilder::new("Close Tab")
        .id("close-tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let m_export_pdf = MenuItemBuilder::new("Export PDF…")
        .id("export-pdf")
        .accelerator("CmdOrCtrl+E")
        .build(handle)?;
    let m_import_latex = MenuItemBuilder::new("Import LaTeX Template…")
        .id("import-latex")
        .build(handle)?;

    let m_undo = MenuItemBuilder::new("Undo")
        .id("undo")
        .accelerator("CmdOrCtrl+Z")
        .build(handle)?;
    let m_redo = MenuItemBuilder::new("Redo")
        .id("redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(handle)?;

    let m_toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
        .id("toggle-sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(handle)?;
    let m_toggle_preview = MenuItemBuilder::new("Toggle Preview")
        .id("toggle-preview")
        .accelerator("CmdOrCtrl+Shift+V")
        .build(handle)?;
    let m_toggle_outline = MenuItemBuilder::new("Toggle Outline")
        .id("toggle-outline")
        .build(handle)?;
    let m_toggle_writing = MenuItemBuilder::new("Toggle Writing Mode")
        .id("toggle-writing-mode")
        .build(handle)?;
    let m_toggle_line_numbers = MenuItemBuilder::new("Toggle Line Numbers")
        .id("toggle-line-numbers")
        .build(handle)?;
    let m_toggle_sidecar = MenuItemBuilder::new("Toggle Sidecar Preview")
        .id("toggle-sidecar-preview")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(handle)?;
    let m_show_history = MenuItemBuilder::new("Toggle File History")
        .id("toggle-history")
        .build(handle)?;

    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&m_new_file)
        .item(&m_new_md)
        .item(&m_new_template)
        .item(&m_open_file)
        .item(&m_open_folder)
        .separator()
        .item(&m_save)
        .item(&m_save_all)
        .separator()
        .item(&m_export_pdf)
        .item(&m_import_latex)
        .separator()
        .item(&m_close_tab)
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .item(&m_undo)
        .item(&m_redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&m_toggle_sidebar)
        .item(&m_toggle_preview)
        .item(&m_toggle_outline)
        .separator()
        .item(&m_toggle_writing)
        .item(&m_toggle_line_numbers)
        .separator()
        .item(&m_show_history)
        .item(&m_toggle_sidecar)
        .build()?;

    let m_settings = MenuItemBuilder::new("Settings…")
        .id("open-settings")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, "Grapheme")
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(&m_settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            "new-file"
            | "new-file-md"
            | "new-from-template"
            | "open-file"
            | "open-folder"
            | "save"
            | "save-all"
            | "close-tab"
            | "export-pdf"
            | "import-latex"
            | "undo"
            | "redo"
            | "toggle-sidebar"
            | "toggle-preview"
            | "toggle-outline"
            | "toggle-writing-mode"
            | "toggle-line-numbers"
            | "toggle-sidecar-preview"
            | "toggle-history"
            | "open-settings" => {
                let _ = app.emit(&format!("menu:{id}"), ());
            }
            _ => {}
        }
    });

    Ok(())
}
