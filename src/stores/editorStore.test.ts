import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore, markPathJustWritten, isRecentlyWritten } from "./editorStore";

// Reset store state before each test so tests are isolated.
const initialSlice = {
  theme: "dark" as const,
  lspStatus: "disconnected" as const,
  previewPages: [] as string[],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle" as const,
  workspacePath: null,
  tabs: [],
  activeTabPath: null,
  editorFontSize: 14,
  lastEditTime: null,
  lastCompileMs: null,
  scrollToLine: null,
  chatSessions: [],
  activeChatSessionId: null,
  references: [],
  selectedText: null,
  documentOutline: [],
  sidebarTab: "files" as const,
  aiDockHeight: 280,
  activePdfPath: null,
  converterWarnings: [],
  scrollToPreviewPage: null,
  compileStartedAt: null,
};

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState(initialSlice);
});

// ── Theme ──────────────────────────────────────────────────────────────────

describe("theme", () => {
  it("defaults to dark", () => {
    expect(useEditorStore.getState().theme).toBe("dark");
  });

  it("setTheme updates theme state", () => {
    useEditorStore.getState().setTheme("claude");
    expect(useEditorStore.getState().theme).toBe("claude");
  });

  it("setTheme persists to localStorage", () => {
    useEditorStore.getState().setTheme("claude");
    expect(localStorage.getItem("app-theme")).toBe("claude");
  });

  it("setTheme back to dark persists correctly", () => {
    useEditorStore.getState().setTheme("claude");
    useEditorStore.getState().setTheme("dark");
    expect(localStorage.getItem("app-theme")).toBe("dark");
    expect(useEditorStore.getState().theme).toBe("dark");
  });
});

// ── LSP status ─────────────────────────────────────────────────────────────

describe("lspStatus", () => {
  it("defaults to disconnected", () => {
    expect(useEditorStore.getState().lspStatus).toBe("disconnected");
  });

  it("setLspStatus updates status", () => {
    useEditorStore.getState().setLspStatus("connected");
    expect(useEditorStore.getState().lspStatus).toBe("connected");
  });

  it("cycles through all states", () => {
    const { setLspStatus } = useEditorStore.getState();
    setLspStatus("connecting");
    expect(useEditorStore.getState().lspStatus).toBe("connecting");
    setLspStatus("connected");
    expect(useEditorStore.getState().lspStatus).toBe("connected");
    setLspStatus("disconnected");
    expect(useEditorStore.getState().lspStatus).toBe("disconnected");
  });
});

// ── Preview ────────────────────────────────────────────────────────────────

describe("preview", () => {
  it("setPreview sets pages, clears error, sets status=success", () => {
    useEditorStore.setState({ previewError: "old error" });
    useEditorStore.getState().setPreview(["<svg>a</svg>", "<svg>b</svg>"]);
    const s = useEditorStore.getState();
    expect(s.previewPages).toEqual(["<svg>a</svg>", "<svg>b</svg>"]);
    expect(s.previewError).toBeNull();
    expect(s.compileStatus).toBe("success");
  });

  it("setPreviewLoading updates loading flag", () => {
    useEditorStore.getState().setPreviewLoading(true);
    expect(useEditorStore.getState().previewLoading).toBe(true);
    useEditorStore.getState().setPreviewLoading(false);
    expect(useEditorStore.getState().previewLoading).toBe(false);
  });

  it("setPreviewError sets error, clears loading, sets status=error", () => {
    useEditorStore.setState({ previewLoading: true });
    useEditorStore.getState().setPreviewError("compile failed");
    const s = useEditorStore.getState();
    expect(s.previewError).toBe("compile failed");
    expect(s.previewLoading).toBe(false);
    expect(s.compileStatus).toBe("error");
  });

  it("setPreviewError(null) clears error", () => {
    useEditorStore.getState().setPreviewError("some error");
    useEditorStore.getState().setPreviewError(null);
    expect(useEditorStore.getState().previewError).toBeNull();
  });

  it("setPreviewZoom clamps to min 0.25", () => {
    useEditorStore.getState().setPreviewZoom(0.1);
    expect(useEditorStore.getState().previewZoom).toBe(0.25);
  });

  it("setPreviewZoom clamps to max 4", () => {
    useEditorStore.getState().setPreviewZoom(10);
    expect(useEditorStore.getState().previewZoom).toBe(4);
  });

  it("setPreviewZoom accepts value within range", () => {
    useEditorStore.getState().setPreviewZoom(1.5);
    expect(useEditorStore.getState().previewZoom).toBe(1.5);
  });

  it("setPreviewZoom accepts exact min", () => {
    useEditorStore.getState().setPreviewZoom(0.25);
    expect(useEditorStore.getState().previewZoom).toBe(0.25);
  });

  it("setPreviewZoom accepts exact max", () => {
    useEditorStore.getState().setPreviewZoom(4);
    expect(useEditorStore.getState().previewZoom).toBe(4);
  });
});

// ── applyPreviewUpdate ─────────────────────────────────────────────────────

describe("applyPreviewUpdate", () => {
  it("populates empty pages from updates", () => {
    useEditorStore.getState().applyPreviewUpdate(2, [
      { index: 0, svg: "svg0" },
      { index: 1, svg: "svg1" },
    ]);
    expect(useEditorStore.getState().previewPages).toEqual(["svg0", "svg1"]);
  });

  it("sets compileStatus=success and clears error", () => {
    useEditorStore.setState({ previewError: "old", compileStatus: "error" });
    useEditorStore.getState().applyPreviewUpdate(1, [{ index: 0, svg: "s" }]);
    const s = useEditorStore.getState();
    expect(s.compileStatus).toBe("success");
    expect(s.previewError).toBeNull();
  });

  it("extends pages when totalPages > current length", () => {
    useEditorStore.setState({ previewPages: ["old0"] });
    useEditorStore.getState().applyPreviewUpdate(3, [{ index: 2, svg: "svg2" }]);
    const pages = useEditorStore.getState().previewPages;
    expect(pages).toHaveLength(3);
    expect(pages[0]).toBe("old0");
    expect(pages[1]).toBe("");
    expect(pages[2]).toBe("svg2");
  });

  it("truncates pages when totalPages < current length", () => {
    useEditorStore.setState({ previewPages: ["a", "b", "c"] });
    useEditorStore.getState().applyPreviewUpdate(2, []);
    expect(useEditorStore.getState().previewPages).toEqual(["a", "b"]);
  });

  it("updates only changed pages in-place", () => {
    useEditorStore.setState({ previewPages: ["orig0", "orig1"] });
    useEditorStore.getState().applyPreviewUpdate(2, [{ index: 0, svg: "new0" }]);
    const pages = useEditorStore.getState().previewPages;
    expect(pages[0]).toBe("new0");
    expect(pages[1]).toBe("orig1");
  });

  it("ignores updates with index >= totalPages", () => {
    useEditorStore.getState().applyPreviewUpdate(1, [
      { index: 0, svg: "valid" },
      { index: 5, svg: "out-of-range" },
    ]);
    expect(useEditorStore.getState().previewPages).toHaveLength(1);
    expect(useEditorStore.getState().previewPages[0]).toBe("valid");
  });
});

// ── Workspace ──────────────────────────────────────────────────────────────

describe("workspacePath", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().workspacePath).toBeNull();
  });

  it("setWorkspacePath updates path", () => {
    useEditorStore.getState().setWorkspacePath("/home/user/project");
    expect(useEditorStore.getState().workspacePath).toBe("/home/user/project");
  });
});

// ── Tabs ───────────────────────────────────────────────────────────────────

describe("tabs", () => {
  it("starts with no tabs", () => {
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabPath).toBeNull();
  });

  it("openTab adds tab and makes it active", () => {
    useEditorStore.getState().openTab("/foo/bar.typ", "bar.typ", "content");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toEqual({ path: "/foo/bar.typ", name: "bar.typ", content: "content", isDirty: false });
    expect(s.activeTabPath).toBe("/foo/bar.typ");
  });

  it("openTab on existing path just activates it without duplicating", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabPath).toBe("/a.typ");
  });

  it("openTempTab opens an untitled temp tab", () => {
    useEditorStore.getState().openTempTab("typ", "/tmp/type-studio/untitled-1.typ");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].isTemp).toBe(true);
    expect(s.tabs[0].name).toBe("untitled-1.typ");
  });

  it("openTempTab with the same path is deduped", () => {
    useEditorStore.getState().openTempTab("typ", "/tmp/type-studio/untitled-1.typ");
    useEditorStore.getState().openTempTab("typ", "/tmp/type-studio/untitled-1.typ");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("promoteTempTab swaps a temp tab's path/name and clears the temp flag", () => {
    useEditorStore.getState().openTempTab("typ", "/tmp/type-studio/untitled-1.typ");
    useEditorStore.getState().promoteTempTab("/tmp/type-studio/untitled-1.typ", "/work/foo.typ", "foo.typ");
    const s = useEditorStore.getState();
    expect(s.tabs[0].path).toBe("/work/foo.typ");
    expect(s.tabs[0].name).toBe("foo.typ");
    expect(s.tabs[0].isTemp).toBe(false);
    expect(s.activeTabPath).toBe("/work/foo.typ");
  });

  it("closeTab removes the tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().closeTab("/a.typ");
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabPath).toBeNull();
  });

  it("closeTab on unknown path is a no-op", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().closeTab("/does-not-exist.typ");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("closeTab activates previous tab when active tab is closed", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().closeTab("/b.typ");
    expect(useEditorStore.getState().activeTabPath).toBe("/a.typ");
  });

  it("closeTab activates next tab when first tab is closed", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    useEditorStore.getState().closeTab("/a.typ");
    // idx was 0, prev is max(0, -1)=0 → next[0] = b.typ
    expect(useEditorStore.getState().activeTabPath).toBe("/b.typ");
  });

  it("setActiveTab switches active tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    expect(useEditorStore.getState().activeTabPath).toBe("/a.typ");
  });

  it("updateTabContent marks tab dirty", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "original");
    useEditorStore.getState().updateTabContent("/a.typ", "modified");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe("modified");
    expect(tab.isDirty).toBe(true);
  });

  it("markTabClean clears dirty flag", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().updateTabContent("/a.typ", "changed");
    useEditorStore.getState().markTabClean("/a.typ");
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
  });

  it("updateTabContent does not affect other tabs", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().updateTabContent("/a.typ", "A-modified");
    expect(useEditorStore.getState().tabs[1].isDirty).toBe(false);
    expect(useEditorStore.getState().tabs[1].content).toBe("B");
  });

  it("syncCleanTabContent refreshes a clean generated-file tab", () => {
    useEditorStore.getState().openTab("/content.typ", "content.typ", "old");
    useEditorStore.getState().syncCleanTabContent("/content.typ", "generated");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe("generated");
    expect(tab.isDirty).toBe(false);
  });

  it("syncCleanTabContent preserves unsaved tab edits", () => {
    useEditorStore.getState().openTab("/content.typ", "content.typ", "old");
    useEditorStore.getState().updateTabContent("/content.typ", "manual edit");
    useEditorStore.getState().syncCleanTabContent("/content.typ", "generated");
    expect(useEditorStore.getState().tabs[0].content).toBe("manual edit");
  });
});

// ── activeTab() helper ─────────────────────────────────────────────────────

describe("activeTab()", () => {
  it("returns null when no tabs open", () => {
    expect(useEditorStore.getState().activeTab()).toBeNull();
  });

  it("returns the currently active tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    const tab = useEditorStore.getState().activeTab();
    expect(tab?.path).toBe("/a.typ");
  });

  it("returns correct tab after switching", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    expect(useEditorStore.getState().activeTab()?.path).toBe("/a.typ");
  });
});

// ── Editor font size ───────────────────────────────────────────────────────

describe("editorFontSize", () => {
  it("defaults to 14", () => {
    expect(useEditorStore.getState().editorFontSize).toBe(14);
  });

  it("setEditorFontSize clamps to min 8", () => {
    useEditorStore.getState().setEditorFontSize(4);
    expect(useEditorStore.getState().editorFontSize).toBe(8);
  });

  it("setEditorFontSize clamps to max 32", () => {
    useEditorStore.getState().setEditorFontSize(100);
    expect(useEditorStore.getState().editorFontSize).toBe(32);
  });

  it("setEditorFontSize accepts value in range", () => {
    useEditorStore.getState().setEditorFontSize(18);
    expect(useEditorStore.getState().editorFontSize).toBe(18);
  });

  it("setEditorFontSize accepts exact min", () => {
    useEditorStore.getState().setEditorFontSize(8);
    expect(useEditorStore.getState().editorFontSize).toBe(8);
  });

  it("setEditorFontSize accepts exact max", () => {
    useEditorStore.getState().setEditorFontSize(32);
    expect(useEditorStore.getState().editorFontSize).toBe(32);
  });
});

// ── Metrics ────────────────────────────────────────────────────────────────

describe("metrics", () => {
  it("lastEditTime defaults to null", () => {
    expect(useEditorStore.getState().lastEditTime).toBeNull();
  });

  it("setLastEditTime updates value", () => {
    const now = Date.now();
    useEditorStore.getState().setLastEditTime(now);
    expect(useEditorStore.getState().lastEditTime).toBe(now);
  });

  it("lastCompileMs defaults to null", () => {
    expect(useEditorStore.getState().lastCompileMs).toBeNull();
  });

  it("setLastCompileMs updates value", () => {
    useEditorStore.getState().setLastCompileMs(42);
    expect(useEditorStore.getState().lastCompileMs).toBe(42);
  });
});

// ── Scroll sync ────────────────────────────────────────────────────────────

describe("scrollToLine", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().scrollToLine).toBeNull();
  });

  it("setScrollToLine updates value", () => {
    useEditorStore.getState().setScrollToLine(42);
    expect(useEditorStore.getState().scrollToLine).toBe(42);
  });

  it("setScrollToLine(null) clears it", () => {
    useEditorStore.getState().setScrollToLine(42);
    useEditorStore.getState().setScrollToLine(null);
    expect(useEditorStore.getState().scrollToLine).toBeNull();
  });
});

// ── scrollToPreviewPage ────────────────────────────────────────────────────

describe("scrollToPreviewPage", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().scrollToPreviewPage).toBeNull();
  });

  it("setScrollToPreviewPage updates value", () => {
    useEditorStore.getState().setScrollToPreviewPage(3);
    expect(useEditorStore.getState().scrollToPreviewPage).toBe(3);
  });

  it("setScrollToPreviewPage(null) clears it", () => {
    useEditorStore.getState().setScrollToPreviewPage(1);
    useEditorStore.getState().setScrollToPreviewPage(null);
    expect(useEditorStore.getState().scrollToPreviewPage).toBeNull();
  });
});

// ── recentlyWritten ────────────────────────────────────────────────────────

describe("markPathJustWritten / isRecentlyWritten", () => {
  it("marks path as recently written", () => {
    markPathJustWritten("/path/to/file.typ");
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(true);
  });

  it("different paths are independent", () => {
    markPathJustWritten("/a.typ");
    markPathJustWritten("/b.typ");
    expect(isRecentlyWritten("/a.typ")).toBe(true);
    expect(isRecentlyWritten("/b.typ")).toBe(true);
    expect(isRecentlyWritten("/c.typ")).toBe(false);
  });
});

// ── Selected text / document outline ───────────────────────────────────────

describe("selectedText", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().selectedText).toBeNull();
  });

  it("setSelectedText updates text", () => {
    useEditorStore.getState().setSelectedText("hello");
    expect(useEditorStore.getState().selectedText).toBe("hello");
  });

  it("setSelectedText(null) clears it", () => {
    useEditorStore.getState().setSelectedText("hello");
    useEditorStore.getState().setSelectedText(null);
    expect(useEditorStore.getState().selectedText).toBeNull();
  });
});

describe("documentOutline", () => {
  it("defaults to empty", () => {
    expect(useEditorStore.getState().documentOutline).toEqual([]);
  });

  it("setDocumentOutline updates outline", () => {
    const outline = [{ level: 1, title: "Test", line: 1 }];
    useEditorStore.getState().setDocumentOutline(outline);
    expect(useEditorStore.getState().documentOutline).toEqual(outline);
  });
});

// ── AI provider settings ───────────────────────────────────────────────────

describe("aiProvider", () => {
  it("defaults to claude-cli", () => {
    expect(useEditorStore.getState().aiProvider).toBe("claude-cli");
  });

  it("setAiProvider updates provider", () => {
    useEditorStore.getState().setAiProvider("ollama");
    expect(useEditorStore.getState().aiProvider).toBe("ollama");
  });

  it("setAiProvider switches back", () => {
    useEditorStore.getState().setAiProvider("ollama");
    useEditorStore.getState().setAiProvider("claude-cli");
    expect(useEditorStore.getState().aiProvider).toBe("claude-cli");
  });
});

describe("ollamaUrl / ollamaModel / claudeModel", () => {
  it("ollamaUrl defaults to http://localhost:11434", () => {
    expect(useEditorStore.getState().ollamaUrl).toBe("http://localhost:11434");
  });

  it("setOllamaUrl updates url", () => {
    useEditorStore.getState().setOllamaUrl("http://other:11434");
    expect(useEditorStore.getState().ollamaUrl).toBe("http://other:11434");
  });

  it("ollamaModel defaults to llama3.2", () => {
    expect(useEditorStore.getState().ollamaModel).toBe("llama3.2");
  });

  it("setOllamaModel updates model", () => {
    useEditorStore.getState().setOllamaModel("mistral");
    expect(useEditorStore.getState().ollamaModel).toBe("mistral");
  });

  it("claudeModel defaults to claude-sonnet-4-6", () => {
    expect(useEditorStore.getState().claudeModel).toBe("claude-sonnet-4-6");
  });

  it("setClaudeModel updates model", () => {
    useEditorStore.getState().setClaudeModel("claude-opus-4-6");
    expect(useEditorStore.getState().claudeModel).toBe("claude-opus-4-6");
  });
});

// ── Chat sessions ──────────────────────────────────────────────────────────

describe("chatSessions", () => {
  it("starts with no sessions", () => {
    expect(useEditorStore.getState().chatSessions).toHaveLength(0);
    expect(useEditorStore.getState().activeChatSessionId).toBeNull();
  });

  it("createChatSession creates a new session and sets it active", () => {
    const id = useEditorStore.getState().createChatSession();
    const s = useEditorStore.getState();
    expect(s.chatSessions).toHaveLength(1);
    expect(s.chatSessions[0].id).toBe(id);
    expect(s.chatSessions[0].title).toBe("New chat");
    expect(s.chatSessions[0].messages).toEqual([]);
    expect(s.activeChatSessionId).toBe(id);
  });

  it("bundles new sessions with the current workspace", () => {
    useEditorStore.getState().setWorkspacePath("/projects/paper");
    const id = useEditorStore.getState().createChatSession();
    expect(useEditorStore.getState().chatSessions.find((session) => session.id === id)?.workspacePath)
      .toBe("/projects/paper");
  });

  it("clears the active session when switching workspaces but preserves both histories", () => {
    useEditorStore.getState().setWorkspacePath("/projects/one");
    const firstId = useEditorStore.getState().createChatSession();
    useEditorStore.getState().setWorkspacePath("/projects/two");
    const secondId = useEditorStore.getState().createChatSession();

    useEditorStore.getState().setWorkspacePath("/projects/one");
    const state = useEditorStore.getState();
    expect(state.activeChatSessionId).toBeNull();
    expect(state.chatSessions.find((session) => session.id === firstId)?.workspacePath).toBe("/projects/one");
    expect(state.chatSessions.find((session) => session.id === secondId)?.workspacePath).toBe("/projects/two");
  });

  it("keeps the active session when setting the same workspace again", () => {
    useEditorStore.getState().setWorkspacePath("/projects/paper/");
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().setWorkspacePath("/projects/paper");
    expect(useEditorStore.getState().activeChatSessionId).toBe(id);
  });

  it("setActiveChatSession switches active session", () => {
    const id1 = useEditorStore.getState().createChatSession();
    useEditorStore.getState().createChatSession();
    useEditorStore.getState().setActiveChatSession(id1);
    expect(useEditorStore.getState().activeChatSessionId).toBe(id1);
  });

  it("updateChatSession sets messages and auto-titles from first user message", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: "Hello, can you help me write a paper?" },
      { role: "assistant", content: "Sure!" },
    ]);
    const s = useEditorStore.getState();
    expect(s.chatSessions[0].messages).toHaveLength(2);
    expect(s.chatSessions[0].title).toBe("Hello, can you help me write a paper?");
  });

  it("updateChatSession preserves custom title", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().renameChatSession(id, "My Custom Title");
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: "Hello" },
    ]);
    expect(useEditorStore.getState().chatSessions[0].title).toBe("My Custom Title");
  });

  it("updateSessionClaudeId sets claude session id", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().updateSessionClaudeId(id, "claude-ses-123");
    expect(useEditorStore.getState().chatSessions[0].claudeSessionId).toBe("claude-ses-123");
  });

  it("renameChatSession updates title", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().renameChatSession(id, "Research Notes");
    expect(useEditorStore.getState().chatSessions[0].title).toBe("Research Notes");
  });

  it("renameChatSession with empty string keeps existing title", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().renameChatSession(id, "Custom");
    useEditorStore.getState().renameChatSession(id, "   ");
    expect(useEditorStore.getState().chatSessions[0].title).toBe("Custom");
  });

  it("forkChatSession duplicates a session and sets active", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: "Hello" },
    ]);
    useEditorStore.getState().renameChatSession(id, "Original");
    useEditorStore.getState().forkChatSession(id);
    const s = useEditorStore.getState();
    expect(s.chatSessions).toHaveLength(2);
    expect(s.chatSessions[1].title).toBe("Fork of Original");
    expect(s.chatSessions[1].messages).toEqual(s.chatSessions[0].messages);
    expect(s.activeChatSessionId).toBe(s.chatSessions[1].id);
  });

  it("forkChatSession on non-existent session is a no-op", () => {
    useEditorStore.getState().forkChatSession("nonexistent");
    expect(useEditorStore.getState().chatSessions).toHaveLength(0);
  });

  it("deleteChatSession removes the session", () => {
    const id = useEditorStore.getState().createChatSession();
    useEditorStore.getState().deleteChatSession(id);
    expect(useEditorStore.getState().chatSessions).toHaveLength(0);
    expect(useEditorStore.getState().activeChatSessionId).toBeNull();
  });

  it("deleteChatSession activates last remaining session when active is deleted", () => {
    useEditorStore.setState({
      chatSessions: [
        { id: "sess-a", title: "A", messages: [], createdAt: 1 },
        { id: "sess-b", title: "B", messages: [], createdAt: 2 },
      ],
      activeChatSessionId: "sess-b",
    });
    useEditorStore.getState().deleteChatSession("sess-b");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
    expect(useEditorStore.getState().activeChatSessionId).toBe("sess-a");
  });

  it("deleteChatSession keeps active session unchanged when non-active is deleted", () => {
    useEditorStore.setState({
      chatSessions: [
        { id: "sess-a", title: "A", messages: [], createdAt: 1 },
        { id: "sess-b", title: "B", messages: [], createdAt: 2 },
      ],
      activeChatSessionId: "sess-a",
    });
    useEditorStore.getState().deleteChatSession("sess-b");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
    expect(useEditorStore.getState().activeChatSessionId).toBe("sess-a");
  });
});

// ── References ─────────────────────────────────────────────────────────────

describe("references", () => {
  it("starts with no references", () => {
    expect(useEditorStore.getState().references).toHaveLength(0);
  });

  it("addReference adds a reference with generated id and timestamp", () => {
    useEditorStore.getState().addReference({
      name: "Paper",
      kind: "pdf",
      bibKey: "key2024",
      title: "A Paper",
    });
    const refs = useEditorStore.getState().references;
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("Paper");
    expect(refs[0].kind).toBe("pdf");
    expect(refs[0].bibKey).toBe("key2024");
    expect(refs[0].id).toMatch(/^ref-/);
    expect(typeof refs[0].addedAt).toBe("number");
  });

  it("addReference prepends to the list", () => {
    useEditorStore.getState().addReference({ name: "First", kind: "link" });
    useEditorStore.getState().addReference({ name: "Second", kind: "bib" });
    expect(useEditorStore.getState().references[0].name).toBe("Second");
  });

  it("removeReference removes by id", () => {
    useEditorStore.getState().addReference({ name: "Paper", kind: "pdf" });
    const id = useEditorStore.getState().references[0].id;
    useEditorStore.getState().removeReference(id);
    expect(useEditorStore.getState().references).toHaveLength(0);
  });

  it("clearReferences removes all references", () => {
    useEditorStore.getState().addReference({ name: "A", kind: "pdf" });
    useEditorStore.getState().addReference({ name: "B", kind: "bib" });
    useEditorStore.getState().clearReferences();
    expect(useEditorStore.getState().references).toHaveLength(0);
  });
});

// ── getAiContext ───────────────────────────────────────────────────────────

describe("getAiContext", () => {
  it("returns empty context when no tabs or references", () => {
    const ctx = useEditorStore.getState().getAiContext();
    expect(ctx).toBe("");
  });

  it("includes outline from active tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "# Title\n\nBody");
    const ctx = useEditorStore.getState().getAiContext();
    expect(ctx).toContain("Document structure:");
    expect(ctx).toContain("Title");
  });

  it("includes references when present", () => {
    useEditorStore.getState().addReference({
      name: "Ref",
      kind: "bib",
      bibKey: "key2024",
      title: "My Paper",
    });
    const ctx = useEditorStore.getState().getAiContext();
    expect(ctx).toContain("Available references:");
    expect(ctx).toContain("@key2024");
  });

  it("includes other open tabs", () => {
    useEditorStore.getState().openTab("/active.typ", "active.typ", "# Active");
    useEditorStore.getState().openTab("/other.typ", "other.typ", "# Other");
    const ctx = useEditorStore.getState().getAiContext();
    expect(ctx).toContain("Other open files:");
    // other.typ is the active tab (last opened), so active.typ should be the "other" file
    expect(ctx).toContain("active.typ");
    expect(ctx).not.toContain("other.typ");
  });
});

// ── Editor tab size ────────────────────────────────────────────────────────

describe("editorTabSize", () => {
  it("defaults to 2", () => {
    expect(useEditorStore.getState().editorTabSize).toBe(2);
  });

  it("setEditorTabSize clamps to min 1", () => {
    useEditorStore.getState().setEditorTabSize(0);
    expect(useEditorStore.getState().editorTabSize).toBe(1);
  });

  it("setEditorTabSize clamps to max 8", () => {
    useEditorStore.getState().setEditorTabSize(10);
    expect(useEditorStore.getState().editorTabSize).toBe(8);
  });

  it("setEditorTabSize rounds to integer", () => {
    useEditorStore.getState().setEditorTabSize(3.7);
    expect(useEditorStore.getState().editorTabSize).toBe(4);
  });

  it("setEditorTabSize accepts value in range", () => {
    useEditorStore.getState().setEditorTabSize(4);
    expect(useEditorStore.getState().editorTabSize).toBe(4);
  });
});

// ── Editor width ───────────────────────────────────────────────────────────

describe("editorWidth", () => {
  it("defaults to 960", () => {
    expect(useEditorStore.getState().editorWidth).toBe(960);
  });

  it("setEditorWidth clamps to min 480", () => {
    useEditorStore.getState().setEditorWidth(100);
    expect(useEditorStore.getState().editorWidth).toBe(480);
  });

  it("setEditorWidth clamps to max 1600", () => {
    useEditorStore.getState().setEditorWidth(2000);
    expect(useEditorStore.getState().editorWidth).toBe(1600);
  });

  it("setEditorWidth accepts value in range", () => {
    useEditorStore.getState().setEditorWidth(800);
    expect(useEditorStore.getState().editorWidth).toBe(800);
  });
});

// ── Editor settings (boolean toggles) ──────────────────────────────────────

describe("editor settings toggles", () => {
  it("editorMdFont defaults correctly", () => {
    expect(useEditorStore.getState().editorMdFont).toContain("Source Serif");
  });

  it("setEditorMdFont updates font", () => {
    useEditorStore.getState().setEditorMdFont("Arial");
    expect(useEditorStore.getState().editorMdFont).toBe("Arial");
  });

  it("editorWordWrap defaults to true", () => {
    expect(useEditorStore.getState().editorWordWrap).toBe(true);
  });

  it("setEditorWordWrap toggles", () => {
    useEditorStore.getState().setEditorWordWrap(false);
    expect(useEditorStore.getState().editorWordWrap).toBe(false);
  });

  it("editorMinimap defaults to true", () => {
    expect(useEditorStore.getState().editorMinimap).toBe(true);
  });

  it("setEditorMinimap toggles", () => {
    useEditorStore.getState().setEditorMinimap(false);
    expect(useEditorStore.getState().editorMinimap).toBe(false);
  });

  it("editorLineNumbers defaults to true", () => {
    expect(useEditorStore.getState().editorLineNumbers).toBe(true);
  });

  it("setEditorLineNumbers toggles", () => {
    useEditorStore.getState().setEditorLineNumbers(false);
    expect(useEditorStore.getState().editorLineNumbers).toBe(false);
  });

  it("typewriterMode defaults to false", () => {
    expect(useEditorStore.getState().typewriterMode).toBe(false);
  });

  it("setTypewriterMode toggles", () => {
    useEditorStore.getState().setTypewriterMode(true);
    expect(useEditorStore.getState().typewriterMode).toBe(true);
  });
});

// ── confirmOnClose ─────────────────────────────────────────────────────────

describe("confirmOnClose", () => {
  it("defaults to true", () => {
    expect(useEditorStore.getState().confirmOnClose).toBe(true);
  });

  it("setConfirmOnClose toggles", () => {
    useEditorStore.getState().setConfirmOnClose(false);
    expect(useEditorStore.getState().confirmOnClose).toBe(false);
  });
});

// ── useSidecarPreview ──────────────────────────────────────────────────────

describe("useSidecarPreview", () => {
  it("setUseSidecarPreview persists to localStorage", () => {
    useEditorStore.getState().setUseSidecarPreview(false);
    expect(localStorage.getItem("use-sidecar-preview")).toBe("0");
    useEditorStore.getState().setUseSidecarPreview(true);
    expect(localStorage.getItem("use-sidecar-preview")).toBe("1");
  });
});

// ── Sidebar tab ────────────────────────────────────────────────────────────

describe("sidebarTab", () => {
  it("defaults to files", () => {
    expect(useEditorStore.getState().sidebarTab).toBe("files");
  });

  it("setSidebarTab switches tab", () => {
    useEditorStore.getState().setSidebarTab("references");
    expect(useEditorStore.getState().sidebarTab).toBe("references");
  });
});

// ── AI dock height ─────────────────────────────────────────────────────────

describe("aiDockHeight", () => {
  it("defaults to 280", () => {
    expect(useEditorStore.getState().aiDockHeight).toBe(280);
  });

  it("setAiDockHeight clamps to min 0", () => {
    useEditorStore.getState().setAiDockHeight(-50);
    expect(useEditorStore.getState().aiDockHeight).toBe(0);
  });

  it("setAiDockHeight accepts positive value", () => {
    useEditorStore.getState().setAiDockHeight(400);
    expect(useEditorStore.getState().aiDockHeight).toBe(400);
  });
});

// ── activePdfPath ──────────────────────────────────────────────────────────

describe("activePdfPath", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().activePdfPath).toBeNull();
  });

  it("setActivePdfPath updates path", () => {
    useEditorStore.getState().setActivePdfPath("/path/to/doc.pdf");
    expect(useEditorStore.getState().activePdfPath).toBe("/path/to/doc.pdf");
  });

  it("setActivePdfPath(null) clears it", () => {
    useEditorStore.getState().setActivePdfPath("/path.pdf");
    useEditorStore.getState().setActivePdfPath(null);
    expect(useEditorStore.getState().activePdfPath).toBeNull();
  });
});

// ── Converter warnings ─────────────────────────────────────────────────────

describe("converterWarnings", () => {
  it("defaults to empty", () => {
    expect(useEditorStore.getState().converterWarnings).toEqual([]);
  });

  it("setConverterWarnings updates warnings", () => {
    useEditorStore.getState().setConverterWarnings(["warning 1", "warning 2"]);
    expect(useEditorStore.getState().converterWarnings).toEqual(["warning 1", "warning 2"]);
  });
});

// ── Panel state ────────────────────────────────────────────────────────────

describe("sidebarOpen", () => {
  it("defaults to true", () => {
    expect(useEditorStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarOpen toggles", () => {
    useEditorStore.getState().setSidebarOpen(false);
    expect(useEditorStore.getState().sidebarOpen).toBe(false);
  });
});

describe("activePanels", () => {
  it("defaults to empty", () => {
    expect(useEditorStore.getState().activePanels).toEqual([]);
  });

  it("setActivePanels updates panels", () => {
    useEditorStore.getState().setActivePanels(["editor", "preview"]);
    expect(useEditorStore.getState().activePanels).toEqual(["editor", "preview"]);
  });
});

describe("panelLayout", () => {
  it("defaults to horizontal", () => {
    expect(useEditorStore.getState().panelLayout).toBe("horizontal");
  });

  it("setPanelLayout switches layout", () => {
    useEditorStore.getState().setPanelLayout("vertical");
    expect(useEditorStore.getState().panelLayout).toBe("vertical");
  });
});

describe("showAiSessions", () => {
  it("defaults to false", () => {
    expect(useEditorStore.getState().showAiSessions).toBe(false);
  });

  it("setShowAiSessions toggles", () => {
    useEditorStore.getState().setShowAiSessions(true);
    expect(useEditorStore.getState().showAiSessions).toBe(true);
  });
});

// ── writingMode / mdSourceMode ─────────────────────────────────────────────

describe("writingMode", () => {
  it("defaults to false", () => {
    expect(useEditorStore.getState().writingMode).toBe(false);
  });

  it("setWritingMode toggles", () => {
    useEditorStore.getState().setWritingMode(true);
    expect(useEditorStore.getState().writingMode).toBe(true);
  });
});

describe("mdSourceMode", () => {
  it("defaults to false", () => {
    expect(useEditorStore.getState().mdSourceMode).toBe(false);
  });

  it("setMdSourceMode toggles", () => {
    useEditorStore.getState().setMdSourceMode(true);
    expect(useEditorStore.getState().mdSourceMode).toBe(true);
  });
});

// ── openTempTab (md variant) ───────────────────────────────────────────────

describe("openTempTab md variant", () => {
  it("opens a .md temp tab with inferred name", () => {
    useEditorStore.getState().openTempTab("md");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].isTemp).toBe(true);
    expect(s.tabs[0].name).toBe("untitled.md");
    expect(s.tabs[0].path).toBe("__temp__/untitled.md");
  });

  it("opens a .typ temp tab by default", () => {
    useEditorStore.getState().openTempTab();
    const s = useEditorStore.getState();
    expect(s.tabs[0].name).toBe("untitled.typ");
    expect(s.tabs[0].path).toBe("__temp__/untitled.typ");
  });
});
