import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { getActiveDragSource } from "../FileExplorer/fileDrag";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { useEditorStore } from "../../stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (src: string) => src,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../FileExplorer/fileDrag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../FileExplorer/fileDrag")>();
  return {
    ...actual,
    getActiveDragSource: vi.fn(() => null),
  };
});

describe("MarkdownWysiwygEditor", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activeTabPath: null,
      editorFontSize: 14,
      editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
      editorWidth: 960,
      theme: "dark",
      workspacePath: "/workspace",
    });
    vi.mocked(getActiveDragSource).mockReturnValue(null);
    vi.mocked(invoke).mockReset();
  });

  it("renders the markdown sample without crashing", async () => {
    const content = readFileSync("examples/markdown/sample.md", "utf8");
    const path = "/workspace/examples/markdown/sample.md";
    useEditorStore.getState().openTab(path, "sample.md", content);

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".markdown-wysiwyg-editor")).toBeInTheDocument();
      expect(container.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  it("renders mynode.md without crashing", async () => {
    const content = readFileSync("examples/markdown/mynode.md", "utf8");
    const path = "/workspace/examples/markdown/mynode.md";
    useEditorStore.getState().openTab(path, "mynode.md", content);

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".markdown-wysiwyg-editor")).toBeInTheDocument();
      expect(container.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  it("syntax highlights active LaTeX math source", async () => {
    const path = "/workspace/examples/markdown/math.md";
    useEditorStore.getState().openTab(path, "math.md", "$\\frac{a}{b} + \\alpha$\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-math-source")).toBeInTheDocument();
      expect(container.querySelector(".cm-md-token-function")).toBeInTheDocument();
      expect(container.querySelector(".cm-md-token-variable")).toBeInTheDocument();
      expect(container.querySelector(".cm-md-token-operator")).toBeInTheDocument();
    });
  });

  it("shows a live rendered preview under active display math source", async () => {
    const path = "/workspace/examples/markdown/display-math.md";
    useEditorStore.getState().openTab(path, "display-math.md", "$$\n\\frac{a}{b} + \\alpha\n$$\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-math-source")).toBeInTheDocument();
      expect(container.querySelector(".cm-md-math-block-live-preview .katex-display")).toBeInTheDocument();
    });
  });

  it("shows display math source when clicking the rendered block", async () => {
    const path = "/workspace/examples/markdown/display-math.md";
    useEditorStore.getState().openTab(path, "display-math.md", "Intro\n\n$$\n\\frac{a}{b} + \\alpha\n$$\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let block: HTMLElement | null = null;
    await waitFor(() => {
      block = container.querySelector(".cm-md-math-block-render");
      expect(block).toBeInTheDocument();
    });

    fireEvent.mouseDown(block!);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-math-source")).toBeInTheDocument();
      expect(container.querySelector(".cm-md-math-block-live-preview .katex-display")).toBeInTheDocument();
    });
  });

  it("lets rendered table cells update the markdown source", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let cell: HTMLElement | null = null;
    await waitFor(() => {
      cell = container.querySelector(".cm-md-table-render tbody td");
      expect(cell).toHaveAttribute("contenteditable", "true");
    });

    cell!.textContent = "Edited";
    fireEvent.input(cell!);
    fireEvent.blur(cell!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toContain("| Edited | 2 |");
    });
  });

  it("selects a rectangular range of rendered table cells with the mouse", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => cells![4]);

    fireEvent.mouseDown(cells![0], { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 20, clientY: 20 });
    fireEvent.mouseUp(document, { button: 0 });

    document.elementFromPoint = originalElementFromPoint;

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("selects a rectangular table range when drag events enter another cell", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    fireEvent.mouseDown(cells![0], { button: 0 });
    fireEvent.mouseOver(cells![4], { buttons: 1 });
    fireEvent.mouseUp(document, { button: 0 });

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("does not hijack native text selection gestures inside one table cell", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| Alpha Beta | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let cell: HTMLElement | null = null;
    await waitFor(() => {
      cell = container.querySelector(".cm-md-table-render tbody td");
      expect(cell).toHaveAttribute("contenteditable", "true");
    });

    const mouseDown = fireEvent.mouseDown(cell!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 4, clientY: 4 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(mouseDown).toBe(true);
    expect(container.querySelectorAll(".cm-md-table-render td.is-selected")).toHaveLength(0);
  });

  it("extends rendered table cell selection with shift-click", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    fireEvent.mouseDown(cells![0], { button: 0 });
    fireEvent.mouseUp(cells![0], { button: 0 });
    fireEvent.mouseDown(cells![4], { button: 0, shiftKey: true });

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("deletes a table row from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteRow = [...container.querySelectorAll("button")].find((button) => button.textContent === "- Row");
    fireEvent.click(deleteRow!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    });
  });

  it("deletes a table column from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteColumn = [...container.querySelectorAll("button")].find((button) => button.textContent === "- Column");
    fireEvent.click(deleteColumn!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    });
  });

  it("deletes the whole table from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteTable = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete table");
    fireEvent.click(deleteTable!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("");
    });
  });

  it("renders markdown images in WYSIWYG mode without exposing source on click", async () => {
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", "![Sample image](assets/photo.png \"Demo\")\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let figure: HTMLElement | null = null;
    await waitFor(() => {
      figure = container.querySelector(".cm-md-image-render");
      expect(figure).toBeInTheDocument();
      expect(container.querySelector(".cm-md-image-render img")).toHaveAttribute("src", "/workspace/examples/markdown/assets/photo.png");
    });

    fireEvent.mouseDown(figure!);

    expect(container.querySelector(".cm-md-image-render")).toBeInTheDocument();
    expect(container.querySelector(".cm-md-image-source")).not.toBeInTheDocument();
  });

  it("shows markdown image source only from the edit source button", async () => {
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", "![Sample image](assets/photo.png)\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-image-render")).toBeInTheDocument();
    });

    const editSource = [...container.querySelectorAll(".cm-md-image-actions button")]
      .find((button) => button.textContent === "Edit source");
    fireEvent.click(editSource!);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-image-source")).toBeInTheDocument();
    });
  });

  it("falls back to ancestor-relative image paths for markdown opened from a nested folder", async () => {
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", "![Sample image](markdown/assets/photo.png)\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let img: HTMLImageElement | null = null;
    await waitFor(() => {
      img = container.querySelector(".cm-md-image-render img");
      expect(img).toHaveAttribute("src", "/workspace/examples/markdown/markdown/assets/photo.png");
    });

    fireEvent.error(img!);

    expect(img).toHaveAttribute("src", "/workspace/examples/markdown/assets/photo.png");
  });

  it("keeps the rendered image DOM when typing before the image", async () => {
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", "![Sample image](assets/photo.png)\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let img: HTMLImageElement | null = null;
    await waitFor(() => {
      img = container.querySelector(".cm-md-image-render img");
      expect(img).toBeInTheDocument();
    });

    const content = container.querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    expect(view).toBeTruthy();

    view!.dispatch({ changes: { from: 0, insert: "hello\n" } });

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("hello\n![Sample image](assets/photo.png)\n");
    });

    expect(container.querySelector(".cm-md-image-render img")).toBe(img);
  });

  it("places the cursor before or after a rendered image from left and right clicks", async () => {
    const source = "![Sample image](assets/photo.png)\n";
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", source);

    const { container } = render(<MarkdownWysiwygEditor />);

    let figure: HTMLElement | null = null;
    await waitFor(() => {
      figure = container.querySelector(".cm-md-image-render");
      expect(figure).toBeInTheDocument();
    });

    const content = container.querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    expect(view).toBeTruthy();
    vi.spyOn(figure!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(figure!, { clientX: 20 });
    expect(view!.state.selection.main.from).toBe(0);

    fireEvent.mouseDown(figure!, { clientX: 180 });
    expect(view!.state.selection.main.from).toBe(source.trimEnd().length);
  });

  it("deletes a rendered image with Backspace and Delete at its edges", async () => {
    const source = "![Sample image](assets/photo.png)\n";
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", source);

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-image-render")).toBeInTheDocument();
    });

    const content = container.querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    expect(view).toBeTruthy();

    view!.dispatch({ selection: EditorSelection.cursor(source.trimEnd().length) });
    fireEvent.keyDown(content, { key: "Backspace" });

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("\n");
    });

    useEditorStore.getState().updateTabContent(path, source);
    view!.dispatch({
      changes: { from: 0, to: view!.state.doc.length, insert: source },
      selection: EditorSelection.cursor(0),
    });
    fireEvent.keyDown(content, { key: "Delete" });

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("\n");
    });
  });

  it("inserts markdown image syntax when an image is dragged from the file sidebar", async () => {
    const path = "/workspace/examples/markdown/image.md";
    useEditorStore.getState().openTab(path, "image.md", "Intro\n");
    vi.mocked(getActiveDragSource).mockReturnValue("/workspace/examples/markdown/assets/photo.png");

    const { container } = render(<MarkdownWysiwygEditor />);

    let editor: HTMLElement | null = null;
    await waitFor(() => {
      editor = container.querySelector(".cm-content");
      expect(editor).toBeInTheDocument();
    });

    fireEvent.drop(editor!, {
      clientX: 0,
      clientY: 0,
      dataTransfer: {
        files: [],
        types: ["application/x-type-studio-path"],
        getData: vi.fn(() => "/workspace/assets/photo.png"),
      },
    });

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("![photo.png](assets/photo.png)Intro\n");
    });
  });
});
