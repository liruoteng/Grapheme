import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useEditorStore, type FileEntry, isRecentlyWritten } from "../../stores/editorStore";
import { logger } from "../../lib/logger";
import { ContextMenu, type ContextMenuItem } from "../Layout/ContextMenu";
import { getFileIconMeta } from "./fileIcons";
import { getActiveDragSource, getFileDragMime, setActiveDragSource } from "./fileDrag";
import { useDragSource, useDropTarget } from "./useFileDragDrop";
import { useFileContextMenu } from "./useFileContextMenu";
import { useFileOperations } from "./useFileOperations";
import "./FileTree.css";

export interface FileTreeHandle {
  newFile: () => void;
  newFolder: () => void;
  refresh: () => void;
}

function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  const meta = getFileIconMeta(name, isDir);

  if (meta.kind === "simple") {
    return (
      <span className={`file-icon simple-icon ${meta.className}`} title={meta.icon.title}>
        <svg viewBox="0 0 24 24" role="img" aria-label={meta.icon.title}>
          <path d={meta.icon.path} />
        </svg>
      </span>
    );
  }

  return <span className={`file-icon ${meta.className}`}>{meta.label}</span>;
}

interface PendingCreate {
  type: "file" | "folder";
  targetDir: string;
  name: string;
  onChangeName: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

interface DirNodeProps {
  path: string;
  name: string;
  depth: number;
  onRefreshParent?: () => void;
  onSelectDir?: (path: string) => void;
  onClearDirSelection?: () => void;
  selectedDirPath?: string | null;
  pendingCreate?: PendingCreate | null;
  refreshVersions: Record<string, number>;
  onRequestMove: (src: string, destDir: string) => void;
  onOsDrop: (files: FileList, destDir: string) => void;
  expandPath?: string | null;
  highlightPath?: string | null;
}

function DirNode({ path, name, depth, onRefreshParent, onSelectDir, onClearDirSelection, selectedDirPath, pendingCreate, refreshVersions, onRequestMove, onOsDrop, expandPath, highlightPath }: DirNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ctxMenu = useFileContextMenu();
  const dragSource = useDragSource(path, name, true);
  const dropTarget = useDropTarget(onRequestMove, onOsDrop, path);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("list_dir", { path });
      setChildren(entries);
    } catch (e) {
      logger.error("list_dir error", e);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  useEffect(() => {
    if (pendingCreate?.targetDir === path) setOpen(true);
  }, [pendingCreate, path]);

  useEffect(() => {
    if (expandPath === path) setOpen(true);
  }, [expandPath, path]);

  const myVersion = refreshVersions[path] ?? 0;
  useEffect(() => {
    if (myVersion > 0 && open) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myVersion]);

  const startRename = useCallback(() => {
    setRenamingTo(name);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 0);
  }, [name]);

  const confirmRename = useCallback(async () => {
    const newName = renamingTo?.trim();
    if (!newName || newName === name) { setRenamingTo(null); return; }
    const newPath = joinPath(parentOf(path), newName);
    try {
      await invoke("rename_path", { oldPath: path, newPath });
      onRefreshParent?.();
    } catch (e) {
      logger.error("rename error", e);
      toast.error("Failed to rename");
    }
    setRenamingTo(null);
  }, [renamingTo, name, path, onRefreshParent]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete folder "${name}" and all its contents?`)) return;
    try {
      await invoke("delete_path", { path });
      onRefreshParent?.();
    } catch (e) {
      logger.error("delete error", e);
      toast.error("Failed to delete folder");
    }
  }, [name, path, onRefreshParent]);

  const ctxItems: ContextMenuItem[] = [
    { label: "Rename", action: startRename },
    { label: "Delete Folder", action: handleDelete },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => invoke("reveal_in_finder", { path }).catch((e) => logger.error("reveal_in_finder error", e)),
    },
  ];

  return (
    <div className="dir-node">
      {renamingTo !== null ? (
        <div
          className="tree-row dir-row"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="dir-arrow">▶</span>
          <input
            ref={renameInputRef}
            className="new-item-input new-item-input--rename"
            value={renamingTo}
            onChange={(e) => setRenamingTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              if (e.key === "Escape") setRenamingTo(null);
            }}
            onBlur={() => setRenamingTo(null)}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
          />
        </div>
      ) : (
        <div
          className={`tree-row dir-row${selectedDirPath === path ? " active" : ""}${dropTarget.dropHover ? " drop-target" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          data-dir-path={path}
          draggable={depth > 0}
          onDragStart={dragSource.onDragStart}
          onDragEnd={dragSource.onDragEnd}
          onDragOver={dropTarget.onDragOver}
          onDragLeave={dropTarget.onDragLeave}
          onDrop={dropTarget.onDrop}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); onSelectDir?.(path); }}
          onContextMenu={ctxMenu.open}
        >
          <span className={`dir-arrow ${open ? "open" : ""}`}>▶</span>
          <span className="tree-label">{name}</span>
          {loading && <span className="loading-dot">…</span>}
        </div>
      )}
      {open && (
        <div
          className="dir-children"
          onDragOver={dropTarget.onDragOver}
          onDragLeave={dropTarget.onDragLeave}
          onDrop={dropTarget.onDrop}
        >
            {pendingCreate?.targetDir === path && (
            <InlineCreateInput pendingCreate={pendingCreate} depth={depth + 1} />
          )}
          {children.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
                onSelectDir={onSelectDir}
                onClearDirSelection={onClearDirSelection}
                selectedDirPath={selectedDirPath}
                pendingCreate={pendingCreate}
                refreshVersions={refreshVersions}
                onRequestMove={onRequestMove}
                onOsDrop={onOsDrop}
                expandPath={expandPath}
                highlightPath={highlightPath}
              />
            ) : (
              <FileNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
                highlighted={highlightPath === entry.path}
                onClearDirSelection={onClearDirSelection}
              />
            )
          )}
        </div>
      )}
      {ctxMenu.position && (
        <ContextMenu
          x={ctxMenu.position.x}
          y={ctxMenu.position.y}
          items={ctxItems}
          onClose={ctxMenu.close}
        />
      )}
    </div>
  );
}

interface FileNodeProps {
  path: string;
  name: string;
  depth: number;
  onRefreshParent?: () => void;
  highlighted?: boolean;
  onClearDirSelection?: () => void;
}

function FileNode({ path, name, depth, onRefreshParent, highlighted, onClearDirSelection }: FileNodeProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ctxMenu = useFileContextMenu();
  const dragSource = useDragSource(path, name, false);

  const openFile = useCallback(async () => {
    if (path.endsWith(".pdf")) {
      const store = useEditorStore.getState();
      store.setActivePdfPath(path);
      if (!store.activePanels.includes("pdf")) {
        store.setActivePanels([...store.activePanels, "pdf"]);
      }
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path });
      openTab(path, name, content);
      const store = useEditorStore.getState();
      if (!store.activePanels.includes("editor")) {
        store.setActivePanels([...store.activePanels, "editor"]);
      }
    } catch (e) {
      logger.error("read_file error", e);
    }
  }, [path, name, openTab]);

  const startRename = useCallback(() => {
    setRenamingTo(name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [name]);

  const confirmRename = useCallback(async () => {
    const newName = renamingTo?.trim();
    if (!newName || newName === name) { setRenamingTo(null); return; }
    const newPath = joinPath(parentOf(path), newName);
    try {
      await invoke("rename_path", { oldPath: path, newPath });
      closeTab(path);
      onRefreshParent?.();
    } catch (e) {
      logger.error("rename error", e);
      toast.error("Failed to rename");
    }
    setRenamingTo(null);
  }, [renamingTo, name, path, closeTab, onRefreshParent]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await invoke("delete_path", { path });
      closeTab(path);
      onRefreshParent?.();
    } catch (e) {
      logger.error("delete error", e);
      toast.error("Failed to delete file");
    }
  }, [name, path, closeTab, onRefreshParent]);

  const ctxItems: ContextMenuItem[] = [
    { label: "Open", action: openFile },
    { separator: true },
    { label: "Rename", action: startRename },
    { label: "Delete", action: handleDelete },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => invoke("reveal_in_finder", { path }).catch((e) => logger.error("reveal_in_finder error", e)),
    },
    {
      label: "Copy Path",
      action: () => navigator.clipboard.writeText(path),
    },
  ];

  if (renamingTo !== null) {
    return (
      <div
        className={`tree-row file-row ${activeTabPath === path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <FileIcon name={renamingTo || name} isDir={false} />
        <input
          ref={renameInputRef}
          className="new-item-input new-item-input--rename"
          value={renamingTo}
          onChange={(e) => setRenamingTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmRename();
            if (e.key === "Escape") setRenamingTo(null);
          }}
          onBlur={() => setRenamingTo(null)}
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
        />
      </div>
    );
  }

  return (
    <>
      <div
        className={`tree-row file-row${activeTabPath === path ? " active" : ""}${highlighted ? " drop-flash" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        draggable
        onDragStart={dragSource.onDragStart}
        onDragEnd={dragSource.onDragEnd}
        onClick={(e) => { e.stopPropagation(); onClearDirSelection?.(); if (!path.endsWith(".pdf")) openFile(); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (path.endsWith(".pdf")) openFile(); }}
        onContextMenu={ctxMenu.open}
      >
        <FileIcon name={name} isDir={false} />
        <span className="tree-label">{name}</span>
      </div>
      {ctxMenu.position && (
        <ContextMenu
          x={ctxMenu.position.x}
          y={ctxMenu.position.y}
          items={ctxItems}
          onClose={ctxMenu.close}
        />
      )}
    </>
  );
}

function InlineCreateInput({ pendingCreate, depth }: { pendingCreate: PendingCreate; depth: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="new-item-row tree-row" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
      <span className="file-icon new-item-icon-spacer" aria-hidden />
      <input
        ref={inputRef}
        className="new-item-input"
        value={pendingCreate.name}
        onChange={(e) => pendingCreate.onChangeName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") pendingCreate.onConfirm();
          if (e.key === "Escape") pendingCreate.onCancel();
        }}
        onBlur={pendingCreate.onCancel}
        placeholder={pendingCreate.type === "file" ? "filename.typ" : "folder name"}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
      />
    </div>
  );
}

export const FileTree = forwardRef<FileTreeHandle, { onOpenFolder: () => void }>(
function FileTree({ onOpenFolder }, ref) {
  const [selectedDirPath, setSelectedDirPath] = useState<string | null>(null);
  const [bodyDropHover, setBodyDropHover] = useState(false);
  const bodyCtxMenu = useFileContextMenu();
  const bodyRef = useRef<HTMLDivElement>(null);
  const ops = useFileOperations();

  const bumpRefreshRef = useRef(ops.bumpRefresh);
  bumpRefreshRef.current = ops.bumpRefresh;

  useEffect(() => {
    const wsPath = ops.workspacePath;
    if (!wsPath) return;
    let stopFn: (() => void) | null = null;
    let mounted = true;
    const bump = bumpRefreshRef.current;

    import("@tauri-apps/plugin-fs").then(({ watchImmediate }) => {
      if (!mounted) return;
      watchImmediate(
        wsPath,
        (event) => {
          const paths = event.paths;
          const rawType = event.type;
          const isCreate = typeof rawType === "object" && "create" in rawType;
          const isModify = typeof rawType === "object" && "modify" in rawType;
          const isRemove = typeof rawType === "object" && "remove" in rawType;
          const isAny = rawType === "any";

          for (const p of paths) {
            if (!p.startsWith(wsPath)) continue;

            if (isRemove) {
              const store = useEditorStore.getState();
              const tab = store.tabs.find((t) => t.path === p);
              if (tab && !tab.isDirty && !tab.isTemp) {
                invoke<string>("read_file", { path: p })
                  .then((content) => {
                    useEditorStore.setState((s) => ({
                      tabs: s.tabs.map((t) =>
                        t.path === p ? { ...t, content, isDirty: false } : t
                      ),
                    }));
                  })
                  .catch(() => {
                    const current = useEditorStore.getState();
                    const curTab = current.tabs.find((t) => t.path === p);
                    if (curTab && !curTab.isDirty) {
                      current.closeTab(p);
                    }
                  });
              }
              bump(parentOf(p));
              continue;
            }

            if (isCreate) {
              bump(parentOf(p));
              continue;
            }

            if (isModify || isAny) {
              const store = useEditorStore.getState();
              const tab = store.tabs.find((t) => t.path === p);
              if (!tab) {
                if (isAny) bump(parentOf(p));
                continue;
              }
              if (tab.isTemp || isRecentlyWritten(p)) continue;

              if (tab.isDirty) {
                const name = p.split("/").pop() ?? p;
                import("@tauri-apps/plugin-dialog").then(({ ask }) => {
                  ask(
                    `"${name}" was modified outside Grapheme. Reload from disk and discard your changes?`,
                    { title: "File Changed Externally", kind: "warning" }
                  ).then((reload) => {
                    if (!reload) return;
                    invoke<string>("read_file", { path: p })
                      .then((content) => {
                        useEditorStore.setState((s) => ({
                          tabs: s.tabs.map((t) =>
                            t.path === p ? { ...t, content, isDirty: false } : t
                          ),
                        }));
                      })
                      .catch(() => {
                        useEditorStore.getState().closeTab(p);
                        bump(parentOf(p));
                      });
                  });
                });
                continue;
              }

              invoke<string>("read_file", { path: p })
                .then((content) => {
                  const current = useEditorStore.getState();
                  const currentTab = current.tabs.find((t) => t.path === p);
                  if (currentTab && !currentTab.isDirty && content !== currentTab.content) {
                    useEditorStore.setState((s) => ({
                      tabs: s.tabs.map((t) =>
                        t.path === p ? { ...t, content } : t
                      ),
                    }));
                  }
                })
                .catch(() => {
                  const store = useEditorStore.getState();
                  const tab = store.tabs.find((t) => t.path === p);
                  if (tab && !tab.isDirty) {
                    store.closeTab(p);
                  }
                  bump(parentOf(p));
                });
              continue;
            }

            bump(parentOf(p));
          }
        },
        { recursive: true }
      ).then((stop) => {
        if (mounted) stopFn = stop;
        else stop();
      });
    });

    return () => {
      mounted = false;
      stopFn?.();
    };
  }, [ops.workspacePath]);

  const { startCreating, handleRefresh } = ops;
  useImperativeHandle(ref, () => ({
    newFile: () => startCreating("file"),
    newFolder: () => startCreating("folder"),
    refresh: handleRefresh,
  }), [startCreating, handleRefresh]);

  const handleCreateConfirm = async () => {
    const name = ops.creating?.name.trim();
    const wsPath = ops.workspacePath;
    if (!name || !wsPath) { ops.setCreating(null); return; }
    const targetDir = selectedDirPath ?? wsPath;
    const fullPath = joinPath(targetDir, name);
    try {
      if (ops.creating!.type === "file") {
        await invoke("create_file", { path: fullPath });
      } else {
        await invoke("create_dir", { path: fullPath });
      }
    } catch (e) {
      logger.error("create error", e);
      toast.error("Failed to create");
    }
    ops.setCreating(null);
    ops.bumpRefresh(targetDir);
  };

  const handleCreateCancel = () => ops.setCreating(null);

  const onBodyClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedDirPath(null);
    }
  };

  const onBodyContextMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    setSelectedDirPath(null);
    bodyCtxMenu.open(e);
  };

  const onBodyDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    const activeDragSource = getActiveDragSource();
    if (!activeDragSource && !hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = activeDragSource ? "move" : "copy";
    if (!bodyDropHover) setBodyDropHover(true);
  };

  const onBodyDragLeave = (e: React.DragEvent) => {
    if (e.target === e.currentTarget) setBodyDropHover(false);
  };

  const onBodyDrop = (e: React.DragEvent) => {
    setBodyDropHover(false);
    const wsPath = ops.workspacePath;
    if (!wsPath) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const dest = selectedDirPath ?? wsPath;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      ops.copyOsFilesInto(e.dataTransfer.files, dest);
      return;
    }
    const src = getActiveDragSource() ?? e.dataTransfer.getData(getFileDragMime());
    if (!src) return;
    setActiveDragSource(null);
    ops.moveNode(src, wsPath);
  };

  const bodyCtxItems: ContextMenuItem[] = [
    { label: "New File", action: () => ops.startCreating("file") },
    { label: "New Folder", action: () => ops.startCreating("folder") },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => ops.workspacePath && invoke("reveal_in_finder", { path: ops.workspacePath }).catch((e) => logger.error("reveal_in_finder error", e)),
      disabled: !ops.workspacePath,
    },
  ];

  return (
    <div className="file-tree">
      <div
        className={`file-tree-body${bodyDropHover ? " drop-target" : ""}`}
        ref={bodyRef}
        onClick={onBodyClick}
        onContextMenu={onBodyContextMenu}
        onDragOver={onBodyDragOver}
        onDragLeave={onBodyDragLeave}
        onDrop={onBodyDrop}
      >
        {ops.workspacePath ? (
          <DirNode
            key={ops.workspacePath}
            path={ops.workspacePath}
            name={ops.workspacePath.split("/").pop() ?? ops.workspacePath}
            depth={0}
            onSelectDir={setSelectedDirPath}
            onClearDirSelection={() => setSelectedDirPath(null)}
            selectedDirPath={selectedDirPath}
            refreshVersions={ops.refreshVersions}
            onRequestMove={ops.moveNode}
            onOsDrop={ops.copyOsFilesInto}
            expandPath={ops.expandPath}
            highlightPath={ops.highlightPath}
            pendingCreate={ops.creating ? {
              type: ops.creating.type,
              targetDir: selectedDirPath ?? ops.workspacePath,
              name: ops.creating.name,
              onChangeName: (n) => ops.setCreating((c) => c ? { ...c, name: n } : null),
              onConfirm: handleCreateConfirm,
              onCancel: handleCreateCancel,
            } : null}
          />
        ) : (
          <div className="file-tree-empty">
            <p>No folder opened</p>
            <button className="open-folder-text-btn" onClick={onOpenFolder}>
              Open Folder
            </button>
          </div>
        )}
      </div>
      {bodyCtxMenu.position && (
        <ContextMenu
          x={bodyCtxMenu.position.x}
          y={bodyCtxMenu.position.y}
          items={bodyCtxItems}
          onClose={bodyCtxMenu.close}
        />
      )}
    </div>
  );
});
