import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import type { LspStatus } from "../components/Editor/lsp-client";
import { extractOutline, formatOutlineForContext, formatReferencesForContext, formatTabsForContext, type OutlineItem } from "../lib/utils";
import { DEFAULT_OLLAMA_URL } from "../lib/constants";
import { logger } from "../lib/logger";
import { isTauriRuntime } from "../lib/tauriRuntime";

// Tracks paths that were just written by the app so the FS watcher
// can skip re-reading them (avoids redundant content update after save).
const recentlyWritten = new Set<string>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function markPathJustWritten(path: string) {
  recentlyWritten.add(path);
  const existing = writeTimers.get(path);
  if (existing) clearTimeout(existing);
  writeTimers.set(path, setTimeout(() => {
    recentlyWritten.delete(path);
    writeTimers.delete(path);
  }, 800));
}
export function isRecentlyWritten(path: string): boolean {
  return recentlyWritten.has(path);
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  elapsed?: number;
}

export interface AiChatSession {
  id: string;
  title: string;
  messages: AiMessage[];
  createdAt: number;
  /** Project directory this conversation belongs to. Omitted on legacy sessions. */
  workspacePath?: string | null;
  claudeSessionId?: string; // CLI session for --resume
  codexSessionId?: string; // Codex CLI thread for resume
}

export function normalizeWorkspacePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function sessionWorkspacePath(session: Pick<AiChatSession, "workspacePath">): string | null {
  return normalizeWorkspacePath(session.workspacePath);
}

/** A reference paper the user has added — local PDF, .bib entry, or link.
 *  Persisted alongside other settings so the workspace remembers them. */
export interface Reference {
  id: string;
  name: string;          // display label (filename or title)
  kind: "pdf" | "bib" | "link";
  path?: string;         // absolute path on disk for PDFs / bib files
  url?: string;          // external link, optional
  bibKey?: string;       // citation key (e.g. "smith2024")
  bibEntry?: string;     // raw BibTeX text, when known
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  addedAt: number;
}

export type SidebarTab = "files" | "references";

export interface Tab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isTemp?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type AppTheme = "dark" | "claude";
export type CompileStatus = "idle" | "success" | "error";

interface EditorState {
  // AI chat sessions
  chatSessions: AiChatSession[];
  activeChatSessionId: string | null;
  streamingChatSessionId: string | null;
  setStreamingChatSession: (id: string | null) => void;
  createChatSession: () => string;
  setActiveChatSession: (id: string | null) => void;
  updateChatSession: (id: string, messages: AiMessage[]) => void;
  updateChatSessionLive: (id: string, messages: AiMessage[]) => void;
  updateSessionClaudeId: (id: string, claudeSessionId: string) => void;
  updateSessionCodexId: (id: string, codexSessionId: string) => void;
  renameChatSession: (id: string, title: string) => void;
  forkChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;
  loadWorkspaceSessions: (path: string) => Promise<void>;

  // AI editor integration
  selectedText: string | null;
  setSelectedText: (text: string | null) => void;
  documentOutline: OutlineItem[];
  setDocumentOutline: (outline: OutlineItem[]) => void;
  getAiContext: () => string;
  aiProvider: "claude-cli" | "codex-cli" | "ollama";
  setAiProvider: (p: "claude-cli" | "codex-cli" | "ollama") => void;
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  ollamaModel: string;
  setOllamaModel: (model: string) => void;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;

  // Theme
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;

  // LSP
  lspStatus: LspStatus;
  setLspStatus: (status: LspStatus) => void;

  // Preview
  previewPages: string[];       // SVG strings, one per page
  previewLoading: boolean;
  previewError: string | null;
  previewZoom: number;          // 1.0 = 100%
  compileStatus: CompileStatus;
  setPreview: (pages: string[]) => void;
  applyPreviewUpdate: (totalPages: number, updates: { index: number; svg: string }[]) => void;
  setPreviewLoading: (v: boolean) => void;
  setPreviewError: (err: string | null) => void;
  setPreviewZoom: (zoom: number) => void;

  // Sidecar preview: when true, render an <iframe> pointing at a
  // `tinymist preview` child process instead of compiling SVG in-process.
  useSidecarPreview: boolean;
  setUseSidecarPreview: (v: boolean) => void;

  // Workspace
  workspacePath: string | null;
  setWorkspacePath: (path: string) => void;
  aiApprovedPaths: string[];
  addAiApprovedPath: (path: string) => void;
  clearAiApprovedPaths: () => void;

  // Open tabs
  tabs: Tab[];
  activeTabPath: string | null;
  openTab: (path: string, name: string, content: string) => void;
  openTempTab: (kind?: "typ" | "md", realPath?: string) => void;
  promoteTempTab: (oldPath: string, newPath: string, newName: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  syncCleanTabContent: (path: string, content: string) => void;
  markTabClean: (path: string) => void;
  mtimeVersion: number;
  bumpMtimeVersion: () => void;

  // Active PDF Panel Path
  activePdfPath: string | null;
  setActivePdfPath: (path: string | null) => void;

  // Editor settings
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  editorMdFont: string;
  setEditorMdFont: (v: string) => void;
  editorTabSize: number;
  setEditorTabSize: (n: number) => void;
  editorWordWrap: boolean;
  setEditorWordWrap: (v: boolean) => void;
  editorMinimap: boolean;
  setEditorMinimap: (v: boolean) => void;
  editorLineNumbers: boolean;
  setEditorLineNumbers: (v: boolean) => void;
  typewriterMode: boolean;
  setTypewriterMode: (v: boolean) => void;
  editorWidth: number;
  setEditorWidth: (v: number) => void;

  // General settings
  confirmOnClose: boolean;
  setConfirmOnClose: (v: boolean) => void;
  defaultPreviewZoom: number;
  setDefaultPreviewZoom: (n: number) => void;

  // Persisted settings lifecycle
  hydrateSettings: () => Promise<void>;

  // Writing mode
  writingMode: boolean;
  setWritingMode: (v: boolean) => void;

  // Markdown source mode (raw textarea vs WYSIWYG)
  mdSourceMode: boolean;
  setMdSourceMode: (v: boolean) => void;

  // Reference papers (drop-zone library)
  references: Reference[];
  addReference: (ref: Omit<Reference, "id" | "addedAt">) => void;
  removeReference: (id: string) => void;
  clearReferences: () => void;

  // Sidebar tab + AI dock height (UI layout)
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  aiDockHeight: number;
  setAiDockHeight: (h: number) => void;

  // Floating sidebar + panel grid
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activePanels: string[];   // ordered list: 'editor' | 'preview' | 'diff' | 'outline' | 'ai'
  setActivePanels: (panels: string[]) => void;
  panelLayout: "vertical" | "horizontal";
  setPanelLayout: (layout: "vertical" | "horizontal") => void;

  showAiSessions: boolean;
  setShowAiSessions: (v: boolean) => void;

  // Converter warnings (from Markdown → Typst pipeline)
  converterWarnings: string[];
  setConverterWarnings: (w: string[]) => void;

  // Metrics
  lastEditTime: number | null;
  setLastEditTime: (t: number) => void;
  lastCompileMs: number | null;
  setLastCompileMs: (ms: number) => void;
  compileStartedAt: number | null;

  // Preview ↔ editor sync
  scrollToLine: number | null;
  setScrollToLine: (line: number | null) => void;
  scrollToPreviewPage: number | null;
  setScrollToPreviewPage: (page: number | null) => void;

  // Active tab helpers
  activeTab: () => Tab | null;
}

// ── Settings persistence ────────────────────────────────────────────────────
// Keys persisted to disk via Tauri (settings.json in app config dir).
const PERSISTED_KEYS = [
  "theme",
  "editorFontSize",
  "editorMdFont",
  "editorTabSize",
  "editorWidth",
  "editorWordWrap",
  "editorMinimap",
  "editorLineNumbers",
  "typewriterMode",
  "useSidecarPreview",
  "defaultPreviewZoom",
  "confirmOnClose",
  "aiProvider",
  "ollamaUrl",
  "ollamaModel",
  "claudeModel",
  "codexModel",
  "chatSessions",
  "writingMode",
  "mdSourceMode",
  "references",
  "sidebarTab",
  "aiDockHeight",
] as const;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let workspacePersistTimer: ReturnType<typeof setTimeout> | null = null;
let workspaceLoadGeneration = 0;
function schedulePersist(getState: () => EditorState) {
  if (!isTauriRuntime()) return;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = getState();
    const payload: Record<string, unknown> = {};
    for (const k of PERSISTED_KEYS) {
      if (k === "chatSessions") {
        // Chat transcripts are stored in the active project's .grapheme folder.
        continue;
      } else {
        payload[k] = (s as unknown as Record<string, unknown>)[k];
      }
    }
    invoke("write_settings", { contents: JSON.stringify(payload, null, 2) }).catch((e) => logger.error("write_settings failed", e));
  }, 150);
}

function scheduleWorkspacePersist(getState: () => EditorState) {
  if (!isTauriRuntime()) return;
  if (workspacePersistTimer) clearTimeout(workspacePersistTimer);
  workspacePersistTimer = setTimeout(() => {
    const s = getState();
    if (!s.workspacePath) return;
    const workspace = normalizeWorkspacePath(s.workspacePath);
    const sessions = s.chatSessions
      .filter((session) => sessionWorkspacePath(session) === workspace && session.messages.length > 0);
    invoke("write_workspace_sessions", {
      workspacePath: workspace,
      contents: JSON.stringify(sessions, null, 2),
    }).catch((e) => logger.error("write_workspace_sessions failed", e));
  }, 150);
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  chatSessions: [],
  activeChatSessionId: null,
  streamingChatSessionId: null,
  setStreamingChatSession: (id) => set({ streamingChatSessionId: id }),
  createChatSession: () => {
    const id = createSessionId();
    const session: AiChatSession = {
      id,
      title: "New chat",
      messages: [],
      createdAt: Date.now(),
      workspacePath: normalizeWorkspacePath(get().workspacePath),
    };
    set((s) => ({ chatSessions: [...s.chatSessions, session], activeChatSessionId: id }));
    scheduleWorkspacePersist(get);
    return id;
  },
  setActiveChatSession: (id) => { set({ activeChatSessionId: id }); schedulePersist(get); },
  updateChatSession: (id, messages) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : {
          ...sess,
          messages,
          title: sess.title === "New chat" && messages.length > 0
            ? (messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "New chat")
            : sess.title,
        }
      ),
    }));
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  updateChatSessionLive: (id, messages) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : {
          ...sess,
          messages,
          title: sess.title === "New chat" && messages.length > 0
            ? (messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "New chat")
            : sess.title,
        }
      ),
    }));
  },
  updateSessionClaudeId: (id, claudeSessionId) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : { ...sess, claudeSessionId }
      ),
    }));
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  updateSessionCodexId: (id, codexSessionId) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : { ...sess, codexSessionId }
      ),
    }));
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  renameChatSession: (id, title) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : { ...sess, title: title.trim() || sess.title }
      ),
    }));
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  forkChatSession: (id) => {
    const original = get().chatSessions.find((s) => s.id === id);
    if (!original) return;
    const newId = createSessionId();
    const forked: AiChatSession = {
      id: newId,
      title: `Fork of ${original.title}`,
      messages: [...original.messages],
      createdAt: Date.now(),
      workspacePath: sessionWorkspacePath(original) ?? get().workspacePath,
    };
    set((s) => ({ chatSessions: [...s.chatSessions, forked], activeChatSessionId: newId }));
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  deleteChatSession: (id) => {
    set((s) => {
      const remaining = s.chatSessions.filter((sess) => sess.id !== id);
      const currentWorkspace = normalizeWorkspacePath(s.workspacePath);
      const workspaceSessions = remaining.filter((sess) => sessionWorkspacePath(sess) === currentWorkspace);
      const nextActive = s.activeChatSessionId === id
        ? (workspaceSessions[workspaceSessions.length - 1]?.id ?? null)
        : s.activeChatSessionId;
      return { chatSessions: remaining, activeChatSessionId: nextActive };
    });
    schedulePersist(get);
    scheduleWorkspacePersist(get);
  },
  loadWorkspaceSessions: async (path) => {
    const workspace = normalizeWorkspacePath(path);
    if (!workspace || !isTauriRuntime()) return;
    const generation = ++workspaceLoadGeneration;
    try {
      const raw = await invoke<string>("read_workspace_sessions", { workspacePath: workspace });
      const parsed = raw ? JSON.parse(raw) : [];
      const loaded = Array.isArray(parsed)
        ? (parsed as AiChatSession[])
            .filter((session) => Array.isArray(session.messages) && session.messages.length > 0)
            .map((session) => ({ ...session, workspacePath: workspace }))
        : [];
      const state = get();
      if (generation !== workspaceLoadGeneration || normalizeWorkspacePath(state.workspacePath) !== workspace) return;

      // Sessions from the old global settings file had no project association.
      // If this project has no local store yet, adopt them once and write them
      // into the project so subsequent launches are fully project-local.
      const legacy = loaded.length === 0
        ? state.chatSessions.filter((session) => sessionWorkspacePath(session) === workspace && session.messages.length > 0)
        : [];
      const sessions = legacy.map((session) => ({ ...session, workspacePath: workspace }));
      const current = state.chatSessions.filter((session) => sessionWorkspacePath(session) !== workspace);
      set({
        chatSessions: [...current, ...(loaded.length > 0 ? loaded : sessions)],
        activeChatSessionId: null,
      });
      if (legacy.length > 0) scheduleWorkspacePersist(get);
    } catch (e) {
      logger.error("read_workspace_sessions failed", e);
    }
  },

  selectedText: null,
  setSelectedText: (text) => set({ selectedText: text }),
  documentOutline: [],
  setDocumentOutline: (outline) => set({ documentOutline: outline }),
  getAiContext: () => {
    const s = get();
    const parts: string[] = [];

    const activeTab = s.tabs.find((t) => t.path === s.activeTabPath);
    if (activeTab?.content) {
      const outline = extractOutline(activeTab.content);
      const outlineStr = formatOutlineForContext(outline);
      if (outlineStr) parts.push(outlineStr);
    }

    const refStr = formatReferencesForContext(s.references);
    if (refStr) parts.push(refStr);

    const tabsStr = formatTabsForContext(s.tabs, s.activeTabPath);
    if (tabsStr) parts.push(tabsStr);

    return parts.join("\n\n");
  },
  aiProvider: "claude-cli",
  setAiProvider: (p) => { set({ aiProvider: p }); schedulePersist(get); },
  ollamaUrl: DEFAULT_OLLAMA_URL,
  setOllamaUrl: (url) => { set({ ollamaUrl: url }); schedulePersist(get); },
  ollamaModel: "llama3.2",
  setOllamaModel: (model) => { set({ ollamaModel: model }); schedulePersist(get); },
  claudeModel: "claude-sonnet-4-6",
  setClaudeModel: (model) => { set({ claudeModel: model }); schedulePersist(get); },
  codexModel: "",
  setCodexModel: (model) => { set({ codexModel: model }); schedulePersist(get); },

  theme: (localStorage.getItem("app-theme") as AppTheme | null) ?? "dark",
  setTheme: (theme) => {
    localStorage.setItem("app-theme", theme);
    set({ theme });
    schedulePersist(get);
  },

  lspStatus: "disconnected",
  setLspStatus: (status) => set({ lspStatus: status }),

  previewPages: [],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle",
  setPreview: (pages) => set({ previewPages: pages, previewError: null, compileStatus: "success" }),

  applyPreviewUpdate: (totalPages, updates) =>
    set((s) => {
      // Resize array if page count changed; reuse existing strings otherwise
      // so per-page Zustand selectors only fire for pages that actually changed.
      const prev = s.previewPages;
      const pages =
        prev.length === totalPages
          ? prev.slice()
          : [
              ...prev.slice(0, totalPages),
              ...Array<string>(Math.max(0, totalPages - prev.length)).fill(""),
            ];
      for (const { index, svg } of updates) {
        if (index < totalPages) pages[index] = svg;
      }
      return { previewPages: pages, previewError: null, compileStatus: "success" };
    }),

  setPreviewLoading: (v) => set(v ? { previewLoading: true, compileStartedAt: performance.now() } : { previewLoading: false }),
  setPreviewError: (err) => set({
    previewError: err,
    previewLoading: false,
    compileStatus: err ? "error" : "success",
  }),
  setPreviewZoom: (zoom) => set({ previewZoom: Math.min(4, Math.max(0.25, zoom)) }),

  useSidecarPreview: (localStorage.getItem("use-sidecar-preview") ?? "1") === "1",
  setUseSidecarPreview: (v) => {
    localStorage.setItem("use-sidecar-preview", v ? "1" : "0");
    set({ useSidecarPreview: v });
    schedulePersist(get);
  },

  workspacePath: null,
  setWorkspacePath: (path) => {
    const nextPath = normalizeWorkspacePath(path);
    const currentPath = normalizeWorkspacePath(get().workspacePath);
    if (nextPath === currentPath) {
      set({ aiApprovedPaths: [] });
      return;
    }
    const sessions = get().chatSessions;
    const hasProjectHistory = sessions.some((session) =>
      sessionWorkspacePath(session) === nextPath && session.messages.length > 0
    );
    const recoveredSessions = !hasProjectHistory && nextPath
      ? sessions.map((session) =>
          sessionWorkspacePath(session) === null && session.messages.length > 0
            ? { ...session, workspacePath: nextPath }
            : session
        )
      : sessions;
    set({
      workspacePath: nextPath,
      chatSessions: recoveredSessions,
      aiApprovedPaths: [],
      activeChatSessionId: null,
    });
    if (recoveredSessions !== sessions) schedulePersist(get);
    if (nextPath) void get().loadWorkspaceSessions(nextPath);
  },
  aiApprovedPaths: [],
  addAiApprovedPath: (path) => set((s) => ({
    aiApprovedPaths: s.aiApprovedPaths.includes(path) ? s.aiApprovedPaths : [...s.aiApprovedPaths, path],
  })),
  clearAiApprovedPaths: () => set({ aiApprovedPaths: [] }),

  tabs: [],
  activeTabPath: null,

  openTab: (path, name, content) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path);
      if (existing) {
        return { activeTabPath: path };
      }
      return {
        tabs: [...s.tabs, { path, name, content, isDirty: false }],
        activeTabPath: path,
      };
    }),

  openTempTab: (kind = "typ", realPath?: string) =>
    set((s) => {
      const ext = kind === "md" ? "md" : "typ";
      const name = realPath ? (realPath.split("/").pop() ?? `untitled.${ext}`) : `untitled.${ext}`;
      const tempPath = realPath ?? `__temp__/${name}`;
      const existing = s.tabs.find((t) => t.path === tempPath);
      if (existing) {
        return { activeTabPath: tempPath };
      }
      return {
        tabs: [...s.tabs, { path: tempPath, name, content: "", isDirty: false, isTemp: true }],
        activeTabPath: tempPath,
      };
    }),

  promoteTempTab: (oldPath, newPath, newName) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath
          ? { ...t, path: newPath, name: newName, isDirty: false, isTemp: false }
          : t
      ),
      activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
    })),

  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path);
      if (idx === -1) return {};
      const next = s.tabs.filter((t) => t.path !== path);
      let nextActive = s.activeTabPath;
      if (s.activeTabPath === path) {
        nextActive = next[Math.max(0, idx - 1)]?.path ?? null;
      }
      return { tabs: next, activeTabPath: nextActive };
    }),

  setActiveTab: (path) => set({ activeTabPath: path }),

  updateTabContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, content, isDirty: true } : t
      ),
    })),

  syncCleanTabContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && !t.isDirty ? { ...t, content } : t
      ),
    })),

  markTabClean: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, isDirty: false } : t
      ),
      mtimeVersion: s.mtimeVersion + 1,
    })),

  activePdfPath: null,
  setActivePdfPath: (path) => set({ activePdfPath: path }),

  editorFontSize: 14,
  setEditorFontSize: (size) => {
    set({ editorFontSize: Math.min(32, Math.max(8, size)) });
    schedulePersist(get);
  },
  editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
  setEditorMdFont: (v) => { set({ editorMdFont: v }); schedulePersist(get); },
  editorTabSize: 2,
  setEditorTabSize: (n) => {
    set({ editorTabSize: Math.min(8, Math.max(1, Math.round(n))) });
    schedulePersist(get);
  },
  editorWordWrap: true,
  setEditorWordWrap: (v) => { set({ editorWordWrap: v }); schedulePersist(get); },
  editorMinimap: true,
  setEditorMinimap: (v) => { set({ editorMinimap: v }); schedulePersist(get); },
  editorLineNumbers: true,
  setEditorLineNumbers: (v) => { set({ editorLineNumbers: v }); schedulePersist(get); },
  typewriterMode: false,
  setTypewriterMode: (v) => { set({ typewriterMode: v }); schedulePersist(get); },
  editorWidth: 960,
  setEditorWidth: (w) => {
    set({ editorWidth: Math.min(1600, Math.max(480, w)) });
    schedulePersist(get);
  },

  confirmOnClose: true,
  setConfirmOnClose: (v) => { set({ confirmOnClose: v }); schedulePersist(get); },
  defaultPreviewZoom: 1,
  setDefaultPreviewZoom: (n) => {
    set({ defaultPreviewZoom: Math.min(4, Math.max(0.25, n)) });
    schedulePersist(get);
  },

  hydrateSettings: async () => {
    if (!isTauriRuntime()) return;

    try {
      const raw = await invoke<string>("read_settings");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<(typeof PERSISTED_KEYS)[number], unknown>>;
      const patch: Partial<EditorState> = {};
      if (typeof parsed.theme === "string") patch.theme = parsed.theme as AppTheme;
      if (typeof parsed.editorFontSize === "number") patch.editorFontSize = parsed.editorFontSize;
      if (typeof parsed.editorMdFont === "string") patch.editorMdFont = parsed.editorMdFont;
      if (typeof parsed.editorTabSize === "number") patch.editorTabSize = parsed.editorTabSize;
      if (typeof parsed.editorWordWrap === "boolean") patch.editorWordWrap = parsed.editorWordWrap;
      if (typeof parsed.editorMinimap === "boolean") patch.editorMinimap = parsed.editorMinimap;
      if (typeof parsed.editorLineNumbers === "boolean") patch.editorLineNumbers = parsed.editorLineNumbers;
      if (typeof parsed.typewriterMode === "boolean") patch.typewriterMode = parsed.typewriterMode;
      if (typeof parsed.editorWidth === "number") patch.editorWidth = parsed.editorWidth;
      if (typeof parsed.useSidecarPreview === "boolean") patch.useSidecarPreview = parsed.useSidecarPreview;
      if (typeof parsed.defaultPreviewZoom === "number") {
        patch.defaultPreviewZoom = parsed.defaultPreviewZoom;
        patch.previewZoom = parsed.defaultPreviewZoom;
      }
      if (typeof parsed.confirmOnClose === "boolean") patch.confirmOnClose = parsed.confirmOnClose;
      // Migrate old "claude" provider value to "claude-cli"
      if (parsed.aiProvider === "claude" || parsed.aiProvider === "claude-cli") patch.aiProvider = "claude-cli";
      else if (parsed.aiProvider === "codex-cli") patch.aiProvider = "codex-cli";
      else if (parsed.aiProvider === "ollama") patch.aiProvider = "ollama";
      if (typeof parsed.ollamaUrl === "string") patch.ollamaUrl = parsed.ollamaUrl;
      if (typeof parsed.ollamaModel === "string") patch.ollamaModel = parsed.ollamaModel;
      if (typeof parsed.claudeModel === "string") patch.claudeModel = parsed.claudeModel;
      if (typeof parsed.codexModel === "string") patch.codexModel = parsed.codexModel;
      if (Array.isArray(parsed.chatSessions)) {
        patch.chatSessions = (parsed.chatSessions as AiChatSession[])
          .filter((session) => Array.isArray(session.messages) && session.messages.length > 0)
          .map((session) => {
            // Preserve the missing-property distinction so first-project
            // recovery can recognize sessions created before workspace scoping.
            if (!Object.prototype.hasOwnProperty.call(session, "workspacePath")) return session;
            return { ...session, workspacePath: normalizeWorkspacePath(session.workspacePath) };
          });
      }
      // The active chat is deliberately ephemeral: reopening Grapheme starts
      // a fresh chat, while the persisted sessions remain available in History.
      patch.activeChatSessionId = null;
      if (typeof parsed.writingMode === "boolean") patch.writingMode = parsed.writingMode;
      if (typeof parsed.mdSourceMode === "boolean") patch.mdSourceMode = parsed.mdSourceMode;
      if (Array.isArray(parsed.references)) patch.references = parsed.references as Reference[];
      if (parsed.sidebarTab === "files" || parsed.sidebarTab === "references") {
        patch.sidebarTab = parsed.sidebarTab;
      }
      if (typeof parsed.aiDockHeight === "number") patch.aiDockHeight = parsed.aiDockHeight;
      set(patch);
    } catch (e) {
      logger.error("hydrateSettings failed", e);
    }
  },

  writingMode: false,
  setWritingMode: (v) => { set({ writingMode: v }); schedulePersist(get); },

  mdSourceMode: false,
  setMdSourceMode: (v) => { set({ mdSourceMode: v }); schedulePersist(get); },

  references: [],
  addReference: (ref) => {
    const full: Reference = {
      ...ref,
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      addedAt: Date.now(),
    };
    set((s) => ({ references: [full, ...s.references] }));
    schedulePersist(get);
  },
  removeReference: (id) => {
    set((s) => ({ references: s.references.filter((r) => r.id !== id) }));
    schedulePersist(get);
  },
  clearReferences: () => {
    set({ references: [] });
    schedulePersist(get);
  },

  sidebarTab: "files",
  setSidebarTab: (tab) => { set({ sidebarTab: tab }); schedulePersist(get); },
  aiDockHeight: 280,
  setAiDockHeight: (h) => { set({ aiDockHeight: Math.max(0, h) }); schedulePersist(get); },

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  activePanels: [],
  setActivePanels: (panels) => set({ activePanels: panels }),
  panelLayout: "horizontal",
  setPanelLayout: (layout) => set({ panelLayout: layout }),

  showAiSessions: false,
  setShowAiSessions: (v) => set({ showAiSessions: v }),

  converterWarnings: [],
  setConverterWarnings: (w) => set({ converterWarnings: w }),

  lastEditTime: null,
  setLastEditTime: (t) => set({ lastEditTime: t }),
  mtimeVersion: 0,
  bumpMtimeVersion: () => set((s) => ({ mtimeVersion: s.mtimeVersion + 1 })),
  lastCompileMs: null,
  setLastCompileMs: (ms) => set({ lastCompileMs: ms }),
  compileStartedAt: null,

  scrollToLine: null,
  setScrollToLine: (line) => set({ scrollToLine: line }),
  scrollToPreviewPage: null,
  setScrollToPreviewPage: (page) => set({ scrollToPreviewPage: page }),

  activeTab: () => {
    const { tabs, activeTabPath } = get();
    return tabs.find((t) => t.path === activeTabPath) ?? null;
  },
}));

export function useActiveTab() {
  return useEditorStore(
    useShallow((s) => s.tabs.find((t) => t.path === s.activeTabPath) ?? null)
  );
}
