import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "../stores/editorStore";
import { logger } from "../lib/logger";

interface MenuListenerDeps {
  handleNewFile: (kind?: "typ" | "md") => void;
  handleSave: (path: string, content: string, isExplicit?: boolean) => void;
  handleSnapshot: (path: string) => void;
  handleExportPdf: () => void;
  handleOpenFolder: () => void;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTemplatePicker: React.Dispatch<React.SetStateAction<boolean>>;
  setImportResult: React.Dispatch<React.SetStateAction<{
    mainTyp: string;
    reportPath: string;
    profile: string | null;
    notes: string[];
  } | null>>;
}

export function useMenuListeners({
  handleNewFile,
  handleSave,
  handleSnapshot,
  handleExportPdf,
  handleOpenFolder,
  setShowHistory,
  setShowSettings,
  setShowTemplatePicker,
  setImportResult,
}: MenuListenerDeps) {
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    const isMac = navigator.platform.startsWith("Mac");
    const modKey = isMac ? "metaKey" : "ctrlKey";

    unlisteners.push(listen("menu:undo", () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", [modKey]: true, bubbles: true, cancelable: true })
      );
    }));
    unlisteners.push(listen("menu:redo", () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", [modKey]: true, shiftKey: true, bubbles: true, cancelable: true })
      );
    }));

    unlisteners.push(listen("menu:new-file", () => handleNewFile("typ")));
    unlisteners.push(listen("menu:new-file-md", () => handleNewFile("md")));

    unlisteners.push(listen("menu:open-file", async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ multiple: false });
        if (typeof selected !== "string") return;
        const content = await invoke<string>("read_file", { path: selected });
        const name = selected.split("/").pop() ?? selected;
        useEditorStore.getState().openTab(selected, name, content);
      } catch (e) {
        logger.error("open file error", e);
      }
    }));

    unlisteners.push(listen("menu:open-folder", handleOpenFolder));
    unlisteners.push(listen("menu:new-from-template", () => setShowTemplatePicker(true)));

    unlisteners.push(listen("menu:save", async () => {
      const tab = useEditorStore.getState().activeTab();
      if (!tab) return;
      await handleSave(tab.path, tab.content);
      handleSnapshot(tab.path);
    }));

    unlisteners.push(listen("menu:save-all", async () => {
      const tabs = useEditorStore.getState().tabs.filter((t) => t.isDirty && !t.isTemp);
      for (const t of tabs) {
        await handleSave(t.path, t.content);
        handleSnapshot(t.path);
      }
    }));

    unlisteners.push(listen("menu:close-tab", () => {
      const path = useEditorStore.getState().activeTabPath;
      if (path) useEditorStore.getState().closeTab(path);
    }));

    unlisteners.push(listen("menu:export-pdf", () => handleExportPdf()));

    unlisteners.push(listen("menu:toggle-sidebar", () => {
      const { sidebarOpen: open, setSidebarOpen: setOpen } = useEditorStore.getState();
      setOpen(!open);
    }));

    unlisteners.push(listen("menu:toggle-preview", () => {
      const { activePanels: panels, setActivePanels: setPanels } = useEditorStore.getState();
      if (panels.includes("preview")) {
        if (panels.length > 1) setPanels(panels.filter((p) => p !== "preview"));
      } else {
        if (panels.length < 4) setPanels([...panels, "preview"]);
      }
    }));

    unlisteners.push(listen("menu:toggle-outline", () => {
      const { activePanels: panels, setActivePanels: setPanels } = useEditorStore.getState();
      if (panels.includes("outline")) {
        if (panels.length > 1) setPanels(panels.filter((p) => p !== "outline"));
      } else {
        if (panels.length < 4) setPanels([...panels, "outline"]);
      }
    }));

    unlisteners.push(listen("menu:toggle-writing-mode", () => {
      const { writingMode: wm, setWritingMode } = useEditorStore.getState();
      setWritingMode(!wm);
    }));

    unlisteners.push(listen("menu:toggle-line-numbers", () => {
      const { editorLineNumbers, setEditorLineNumbers } = useEditorStore.getState();
      setEditorLineNumbers(!editorLineNumbers);
    }));

    unlisteners.push(listen("menu:toggle-history", () => {
      setShowHistory((v) => !v);
    }));

    unlisteners.push(listen("menu:open-settings", () => {
      setShowSettings(true);
    }));

    unlisteners.push(listen("menu:import-latex", async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const zipPath = await open({
          multiple: false,
          filters: [{ name: "Zip Archive", extensions: ["zip"] }],
          title: "Select LaTeX Template Bundle (.zip)",
        });
        if (typeof zipPath !== "string") return;

        const workspace = useEditorStore.getState().workspacePath;
        let destDir: string;
        if (workspace) {
          const stem = zipPath.split("/").pop()?.replace(/\.zip$/i, "") ?? "latex-import";
          destDir = `${workspace}/${stem}-typst`;
        } else {
          const dir = zipPath.slice(0, zipPath.lastIndexOf("/"));
          const stem = zipPath.split("/").pop()?.replace(/\.zip$/i, "") ?? "latex-import";
          destDir = `${dir}/${stem}-typst`;
        }

        const result = await invoke<{
          profile: string | null;
          dest_dir: string;
          main_typ: string;
          report_path: string;
          notes: string[];
        }>("import_latex_template", { zipPath, destDir });

        const content = await invoke<string>("read_file", { path: result.main_typ });
        const name = result.main_typ.split("/").pop() ?? "main.typ";
        useEditorStore.getState().openTab(result.main_typ, name, content);
        if (workspace) {
          useEditorStore.getState().setWorkspacePath(workspace);
        }

        setImportResult({
          mainTyp: result.main_typ,
          reportPath: result.report_path,
          profile: result.profile,
          notes: result.notes,
        });
      } catch (e) {
        logger.error("import-latex error", e);
        alert(`LaTeX import failed:\n${e}`);
      }
    }));

    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, [handleNewFile, handleSave, handleSnapshot, handleExportPdf, handleOpenFolder, setShowHistory, setShowSettings, setShowTemplatePicker, setImportResult]);
}
