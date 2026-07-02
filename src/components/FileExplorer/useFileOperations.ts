import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import { logger } from "../../lib/logger";

type ConflictChoice = "replace" | "stop" | "duplicate";

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function isSelfOrDescendant(source: string, target: string): boolean {
  if (source === target) return true;
  return target.startsWith(source + "/");
}

export function useFileOperations() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const [refreshVersions, setRefreshVersions] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState<null | { type: "file" | "folder"; name: string }>(null);
  const [expandPath, setExpandPath] = useState<string | null>(null);
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const askConflict = useCallback(async (srcName: string, destDirName: string): Promise<ConflictChoice> => {
    const btn = await invoke<string>("show_move_conflict_dialog", { srcName, destDirName });
    return btn === "Replace" ? "replace" : btn === "Keep Both" ? "duplicate" : "stop";
  }, []);

  const flashTarget = useCallback((dir: string, filePath: string) => {
    setExpandPath(dir);
    setHighlightPath(filePath);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightPath(null);
      highlightTimer.current = null;
    }, 1600);
  }, []);

  const bumpRefresh = useCallback((dir: string) => {
    setRefreshVersions((r) => ({ ...r, [dir]: (r[dir] ?? 0) + 1 }));
  }, []);

  const moveNode = useCallback(async (src: string, destDir: string) => {
    if (!workspacePath) return;
    if (isSelfOrDescendant(src, destDir)) return;
    const srcParent = parentOf(src);
    if (srcParent === destDir) return;

    const name = basename(src);
    let destPath = joinPath(destDir, name);

    const exists = await invoke<boolean>("path_exists", { path: destPath });
    if (exists) {
      const choice = await askConflict(name, basename(destDir) || destDir);

      if (choice === "stop") return;

      if (choice === "replace") {
        try {
          await invoke("delete_path", { path: destPath });
        } catch (e) {
          logger.error("delete before replace error", e);
          alert(`Failed to replace: ${e}`);
          return;
        }
      } else {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext  = dot > 0 ? name.slice(dot) : "";
        let i = 2;
        while (true) {
          const candidate = joinPath(destDir, `${stem} (${i})${ext}`);
          const taken = await invoke<boolean>("path_exists", { path: candidate });
          if (!taken) { destPath = candidate; break; }
          i++;
        }
      }
    }

    try {
      await invoke("rename_path", { oldPath: src, newPath: destPath });
      bumpRefresh(srcParent);
      bumpRefresh(destDir);
      flashTarget(destDir, destPath);
    } catch (e) {
      logger.error("move error", e);
      alert(`Failed to move: ${e}`);
    }
  }, [workspacePath, bumpRefresh, flashTarget, askConflict]);

  const copyOsFilesInto = useCallback(async (files: FileList, targetDir: string) => {
    let lastDest: string | null = null;
    for (const f of Array.from(files)) {
      const dest = joinPath(targetDir, f.name);
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        await invoke("write_file_bytes", { path: dest, bytes: Array.from(buf) });
        lastDest = dest;
      } catch (e) {
        logger.error("write_file_bytes error", f.name, e);
        alert(`Failed to copy ${f.name}: ${e}`);
      }
    }
    bumpRefresh(targetDir);
    if (lastDest) flashTarget(targetDir, lastDest);
  }, [bumpRefresh, flashTarget]);

  const startCreating = useCallback((type: "file" | "folder") => {
    setCreating({ type, name: "" });
  }, []);

  const handleRefresh = useCallback(() => {
    if (workspacePath) bumpRefresh(workspacePath);
  }, [workspacePath, bumpRefresh]);

  return {
    workspacePath,
    refreshVersions,
    creating,
    setCreating,
    expandPath,
    highlightPath,
    bumpRefresh,
    moveNode,
    copyOsFilesInto,
    startCreating,
    handleRefresh,
  };
}
