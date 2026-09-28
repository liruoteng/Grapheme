import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { useEditorStore } from "../../stores/editorStore";
import { copyImageFilesToAssets } from "../../lib/utils";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (src: string) => src, invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/utils")>(),
  copyImageFilesToAssets: vi.fn(),
}));

function editorView(container: HTMLElement) {
  return EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
}

describe("Markdown editor document lifecycle", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [], activeTabPath: null, workspacePath: "/workspace",
      typewriterMode: false, markdownCodeLineNumbers: false,
      editorFontSize: 19, editorMdFont: "Georgia", selectedText: null,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("does not overwrite the old document when the first store notification switches tabs", () => {
    useEditorStore.getState().openTab("/workspace/b.md", "b.md", "Beta");
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha");
    const { container } = render(<MarkdownWysiwygEditor />);

    act(() => useEditorStore.getState().setActiveTab("/workspace/b.md"));

    expect(editorView(container).state.doc.toString()).toBe("Beta");
    expect(useEditorStore.getState().tabs.find((tab) => tab.path.endsWith("a.md")))
      .toMatchObject({ content: "Alpha", isDirty: false });
  });

  it("persists edits to both documents when switching and typing before autosave", () => {
    const onSave = vi.fn();
    const onPreviewTrigger = vi.fn();
    useEditorStore.getState().openTab("/workspace/b.md", "b.md", "Beta");
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha");
    const { container, unmount } = render(<MarkdownWysiwygEditor onSave={onSave} onPreviewTrigger={onPreviewTrigger} />);
    vi.useFakeTimers();
    act(() => editorView(container).dispatch({ changes: { from: 5, insert: "!" } }));
    act(() => useEditorStore.getState().setActiveTab("/workspace/b.md"));
    expect(onSave).toHaveBeenCalledWith("/workspace/a.md", "Alpha!", false);
    expect(onPreviewTrigger).toHaveBeenCalledWith("/workspace/a.md", "Alpha!");

    act(() => editorView(container).dispatch({ changes: { from: 4, insert: "?" } }));
    act(() => vi.advanceTimersByTime(1500));
    expect(onSave).toHaveBeenCalledWith("/workspace/b.md", "Beta?", false);
    expect(onSave).toHaveBeenCalledTimes(2);
    unmount();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("keeps file-watcher refreshes clean and does not echo them back to disk", () => {
    const onSave = vi.fn();
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Old");
    const { container, unmount } = render(<MarkdownWysiwygEditor onSave={onSave} />);
    act(() => editorView(container).dispatch({ selection: { anchor: 2 } }));
    vi.useFakeTimers();
    act(() => useEditorStore.getState().syncCleanTabContent("/workspace/a.md", "New contents"));

    expect(editorView(container).state.doc.toString()).toBe("New contents");
    expect(editorView(container).state.selection.main.head).toBe(2);
    expect(useEditorStore.getState().activeTab()?.isDirty).toBe(false);
    act(() => vi.advanceTimersByTime(1500));
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("retains font and code-line settings after recreating the editor for another tab", () => {
    const source = "Intro\n\n```js\nconst x = 1;\n```";
    useEditorStore.getState().openTab("/workspace/b.md", "b.md", source);
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha");
    const { container } = render(<MarkdownWysiwygEditor />);
    act(() => useEditorStore.getState().setActiveTab("/workspace/b.md"));

    expect(getComputedStyle(editorView(container).dom).fontSize).toBe("19px");
    expect(getComputedStyle(editorView(container).dom).fontFamily).toBe("Georgia");
    expect(container.querySelector(".cm-md-code-line-number")).toBeNull();
  });

  it("opens a frontmatter-only document without selecting beyond the document", () => {
    const source = "---\ntitle: Example\n---";
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", source);
    const { container } = render(<MarkdownWysiwygEditor />);
    expect(editorView(container).state.selection.main.head).toBe(source.length);
  });

  it("maps a pending image drop through intervening edits", async () => {
    let resolveCopy!: (names: string[]) => void;
    vi.mocked(copyImageFilesToAssets).mockReturnValue(new Promise((resolve) => { resolveCopy = resolve; }));
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha");
    const { container } = render(<MarkdownWysiwygEditor />);
    const view = editorView(container);
    vi.spyOn(view, "posAtCoords").mockReturnValue(5);
    fireEvent.drop(view.contentDOM, { dataTransfer: { types: ["Files"], files: [new File(["png"], "image.png", { type: "image/png" })] } });
    act(() => view.dispatch({ changes: { from: 0, insert: "Before " } }));
    await act(async () => resolveCopy(["image.png"]));
    expect(view.state.doc.toString()).toBe("Before Alpha![image.png](assets/image.png)");
  });

  it("ignores an image copy that finishes after its document is closed", async () => {
    let resolveCopy!: (names: string[]) => void;
    vi.mocked(copyImageFilesToAssets).mockReturnValue(new Promise((resolve) => { resolveCopy = resolve; }));
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha");
    const { container } = render(<MarkdownWysiwygEditor />);
    const view = editorView(container);
    vi.spyOn(view, "posAtCoords").mockReturnValue(5);
    fireEvent.drop(view.contentDOM, { dataTransfer: { types: ["Files"], files: [new File(["png"], "image.png", { type: "image/png" })] } });
    act(() => useEditorStore.getState().openTab("/workspace/b.md", "b.md", "Beta"));
    const oldDispatch = vi.spyOn(view, "dispatch");
    await act(async () => resolveCopy(["image.png"]));
    expect(oldDispatch).not.toHaveBeenCalled();
    expect(editorView(container).state.doc.toString()).toBe("Beta");
  });

  it("does not accumulate layout decorations in the parsing context before an edit", () => {
    const source = Array.from({ length: 300 }, (_, i) => `# Heading ${i}`).join("\n");
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", source);
    const { container } = render(<MarkdownWysiwygEditor />);
    const view = editorView(container);
    const countDecorations = () => view.state.facet(EditorView.decorations)
      .reduce((sum, decorations) => sum + (typeof decorations === "function" ? 0 : decorations.size), 0);
    const before = countDecorations();

    for (let i = 0; i < 5; i += 1) {
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } }));
    }

    expect(countDecorations()).toBe(before);
  });

  it("captures source offsets for an agent edit without changing the selection", () => {
    useEditorStore.getState().openTab("/workspace/a.md", "a.md", "Alpha Beta");
    const { container } = render(<MarkdownWysiwygEditor />);
    act(() => editorView(container).dispatch({ selection: { anchor: 6, head: 10 } }));
    const capture = vi.fn();
    window.dispatchEvent(new CustomEvent("editor:capture-selection", { detail: { capture } }));
    expect(capture).toHaveBeenCalledWith({ from: 6, to: 10 });
  });
});
