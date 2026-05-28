import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEditorStore } from "../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));

const initialSlice = {
  chatSessions: [],
  activeChatSessionId: null,
  selectedText: null,
  aiProvider: "claude-cli" as const,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  claudeModel: "claude-sonnet-4-6",
  theme: "dark" as const,
  lspStatus: "disconnected" as const,
  previewPages: [] as string[],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle" as const,
  useSidecarPreview: true,
  workspacePath: null,
  tabs: [],
  activeTabPath: null,
  activePdfPath: null,
  editorFontSize: 14,
  editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
  editorTabSize: 2,
  editorWordWrap: true,
  editorMinimap: true,
  editorLineNumbers: true,
  typewriterMode: false,
  editorWidth: 960,
  confirmOnClose: true,
  defaultPreviewZoom: 1,
  writingMode: false,
  mdSourceMode: false,
  references: [],
  sidebarTab: "files" as const,
  aiDockHeight: 280,
  sidebarOpen: true,
  activePanels: [],
  panelLayout: "horizontal" as const,
  showAiSessions: false,
  converterWarnings: [],
  lastEditTime: null,
  lastCompileMs: null,
  compileStartedAt: null,
  scrollToLine: null,
  scrollToPreviewPage: null,
};

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState(initialSlice);
});

describe("Tab lifecycle integration", () => {
  it("opens a tab, edits it, marks clean, and closes it", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/doc.typ", "doc.typ", "# Hello");
    expect(s().tabs).toHaveLength(1);
    expect(s().activeTabPath).toBe("/doc.typ");
    expect(s().tabs[0].isDirty).toBe(false);

    s().updateTabContent("/doc.typ", "# Hello World");
    expect(s().tabs[0].content).toBe("# Hello World");
    expect(s().tabs[0].isDirty).toBe(true);

    s().markTabClean("/doc.typ");
    expect(s().tabs[0].isDirty).toBe(false);

    s().closeTab("/doc.typ");
    expect(s().tabs).toHaveLength(0);
    expect(s().activeTabPath).toBeNull();
  });

  it("switches between multiple tabs", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/a.typ", "a.typ", "A");
    s().openTab("/b.typ", "b.typ", "B");
    s().openTab("/c.typ", "c.typ", "C");
    expect(s().tabs).toHaveLength(3);
    expect(s().activeTabPath).toBe("/c.typ");

    s().setActiveTab("/a.typ");
    expect(s().activeTabPath).toBe("/a.typ");

    s().closeTab("/a.typ");
    expect(s().tabs).toHaveLength(2);
    expect(s().activeTabPath).not.toBe("/a.typ");
  });

  it("closing active tab switches to neighbor", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/first.typ", "first.typ", "1");
    s().openTab("/second.typ", "second.typ", "2");
    expect(s().activeTabPath).toBe("/second.typ");

    s().closeTab("/second.typ");
    expect(s().tabs).toHaveLength(1);
    expect(s().activeTabPath).toBe("/first.typ");
  });

  it("openTempTab creates an untitled tab and promoteTab makes it permanent", () => {
    const s = () => useEditorStore.getState();

    s().openTempTab("md");
    expect(s().tabs).toHaveLength(1);
    expect(s().tabs[0].isTemp).toBe(true);
    const tempPath = s().tabs[0].path;

    s().promoteTempTab(tempPath, "/real-file.md", "real-file.md");
    expect(s().tabs[0].isTemp).toBeFalsy();
    expect(s().tabs[0].path).toBe("/real-file.md");
    expect(s().tabs[0].name).toBe("real-file.md");
  });
});

describe("Tab + AI chat integration", () => {
  it("AI context includes active tab outline and references", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/doc.typ", "doc.typ", "# Introduction\nSome content here.");
    s().addReference({
      name: "ref.pdf",
      kind: "pdf",
      bibKey: "doe2024",
      title: "A Reference",
      authors: ["Jane Doe"],
      year: 2024,
    });

    const context = s().getAiContext();
    expect(context).toContain("Introduction");
    expect(context).toContain("doe2024");
  });

  it("chat session persists across tab switches", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/a.typ", "a.typ", "A");
    s().openTab("/b.typ", "b.typ", "B");

    const chatId = s().createChatSession();
    s().updateChatSession(chatId, [
      { role: "user", content: "Help with this doc" },
    ]);

    s().setActiveTab("/a.typ");
    s().setActiveTab("/b.typ");

    expect(s().chatSessions).toHaveLength(1);
    expect(s().activeChatSessionId).toBe(chatId);
    expect(s().chatSessions[0].messages).toHaveLength(1);
  });
});

describe("Tab + references integration", () => {
  it("references persist while switching tabs", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/paper.typ", "paper.typ", "# Paper");
    s().addReference({
      name: "ref.pdf",
      kind: "pdf",
      path: "/refs/ref.pdf",
      bibKey: "doe2024",
      title: "A Reference Paper",
      authors: ["Jane Doe"],
      year: 2024,
    });

    s().openTab("/other.typ", "other.typ", "Other");
    expect(s().references).toHaveLength(1);
    expect(s().references[0].bibKey).toBe("doe2024");

    s().setActiveTab("/paper.typ");
    expect(s().references).toHaveLength(1);
  });
});

describe("Editor settings affect tab behavior", () => {
  it("tab size setting applies across tabs", () => {
    const s = () => useEditorStore.getState();

    s().setEditorTabSize(4);
    expect(s().editorTabSize).toBe(4);

    s().openTab("/a.typ", "a.typ", "content");
    s().openTab("/b.typ", "b.typ", "content");
    expect(s().editorTabSize).toBe(4);
  });

  it("writing mode can be toggled while editing", () => {
    const s = () => useEditorStore.getState();

    s().openTab("/doc.md", "doc.md", "# Draft");
    expect(s().writingMode).toBe(false);

    s().setWritingMode(true);
    expect(s().writingMode).toBe(true);
    expect(s().tabs[0].content).toBe("# Draft");
  });
});
