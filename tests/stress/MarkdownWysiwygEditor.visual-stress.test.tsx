import { fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownWysiwygEditor } from "../../src/components/Editor/MarkdownWysiwygEditor";
import { getActiveDragSource } from "../../src/components/FileExplorer/fileDrag";
import { useEditorStore } from "../../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (src: string) => src,
  invoke: vi.fn().mockResolvedValue(""),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../src/components/FileExplorer/fileDrag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/components/FileExplorer/fileDrag")>();
  return {
    ...actual,
    getActiveDragSource: vi.fn(() => null),
  };
});

const MAX_MOUNT_MS = Number(import.meta.env.STRESS_MAX_WYSIWYG_MOUNT_MS ?? 1_500);
const MAX_OPS_MS = Number(import.meta.env.STRESS_MAX_WYSIWYG_OPS_MS ?? 2_500);

function installGeometryMocks() {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 960,
    bottom: 24,
    width: 960,
    height: 24,
    toJSON: () => ({}),
  } as DOMRect;

  Range.prototype.getClientRects = () => ({
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [0]: rect,
    [Symbol.iterator]: function* () {
      yield rect;
    },
  } as DOMRectList);
  Range.prototype.getBoundingClientRect = () => rect;
  HTMLElement.prototype.scrollTo = vi.fn();
}

function makeStressMarkdown(sections: number): string {
  const parts = ["---", "title: WYSIWYG Stress", "draft: true", "---", ""];
  for (let i = 0; i < sections; i++) {
    parts.push(
      `# Section ${i}`,
      "",
      `Paragraph ${i} with **bold**, _italic_, [link](https://example.com/${i}), @paper${i}, and inline code \`x_${i}\`.`,
      "",
      "- [ ] Task item",
      "- [x] Done item",
      "",
      "| A | B | C |",
      "| --- | --- | --- |",
      `| ${i} | ${i + 1} | ${i + 2} |`,
      "",
      "```ts",
      `const value${i} = ${i};`,
      "```",
      "",
    );
  }
  return parts.join("\n");
}

function expectWithinBudget(label: string, durationMs: number, maxMs: number) {
  console.log(`[stress] ${label}: ${durationMs.toFixed(1)}ms / ${maxMs}ms`);
  expect(durationMs).toBeLessThan(maxMs);
}

describe("MarkdownWysiwygEditor visual stress", () => {
  beforeEach(() => {
    installGeometryMocks();
    localStorage.clear();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useEditorStore.setState({
      editorFontSize: 14,
      editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
      editorWidth: 960,
      theme: "dark",
      workspacePath: "/workspace",
      references: Array.from({ length: 80 }, (_, i) => ({
        id: `ref-${i}`,
        name: `paper-${i}.pdf`,
        kind: "pdf" as const,
        bibKey: `paper${i}`,
        title: `Paper ${i}`,
        addedAt: i,
      })),
    });
    vi.mocked(getActiveDragSource).mockReturnValue(null);
  });

  it("survives high-frequency inserts, selection, and scrolling without visual DOM collapse", async () => {
    const path = "/workspace/stress/wysiwyg.md";
    const initialContent = makeStressMarkdown(90);
    useEditorStore.getState().openTab(path, "wysiwyg.md", initialContent);

    const mountStart = performance.now();
    const { container } = render(
      <MarkdownWysiwygEditor
        onSave={vi.fn()}
        onPreviewTrigger={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".markdown-wysiwyg-editor .cm-editor")).toBeInTheDocument();
      expect(container.querySelector(".cm-content")).toBeInTheDocument();
    });
    expectWithinBudget("wysiwyg mount", performance.now() - mountStart, MAX_MOUNT_MS);

    const content = container.querySelector(".cm-content") as HTMLElement;
    const scroller = container.querySelector(".cm-scroller") as HTMLElement;
    expect(content).toBeTruthy();
    expect(scroller).toBeTruthy();

    const opsStart = performance.now();
    await act(async () => {
      for (let i = 0; i < 180; i++) {
        window.dispatchEvent(new CustomEvent("editor:insert", {
          detail: `\nFast edit ${i}: **bold** _italic_ \`code\` [link](https://example.com/${i})`,
        }));

        if (i % 10 === 0) {
          fireEvent.mouseDown(content, { clientX: 48, clientY: 24, button: 0 });
          fireEvent.mouseUp(content, { clientX: 260, clientY: 24, button: 0 });
        }
        if (i % 15 === 0) {
          fireEvent.scroll(scroller, { target: { scrollTop: i * 18 } });
        }
      }
    });
    expectWithinBudget("wysiwyg high-frequency operations", performance.now() - opsStart, MAX_OPS_MS);

    await waitFor(() => {
      const state = useEditorStore.getState();
      const tab = state.tabs.find((t) => t.path === path);
      expect(tab?.content).toContain("Fast edit 179");
      expect(tab?.isDirty).toBe(true);
    });

    const lineCount = container.querySelectorAll(".cm-line").length;
    const tableCount = container.querySelectorAll(".cm-md-table-render").length;
    const codeBlockCount = container.querySelectorAll(".cm-md-code-block-line").length;
    const activeLinkSourceCount = container.querySelectorAll(".cm-md-active-link-marker").length;
    const editor = container.querySelector(".markdown-wysiwyg") as HTMLElement;

    console.log(`[stress] visual nodes: lines=${lineCount} tables=${tableCount} codeBlocks=${codeBlockCount} activeLinkSources=${activeLinkSourceCount}`);

    expect(editor).toBeInTheDocument();
    expect(editor.getAttribute("class")).toContain("markdown-wysiwyg--dark");
    expect(lineCount).toBeGreaterThan(20);
    expect(tableCount).toBeGreaterThan(0);
    expect(codeBlockCount).toBeGreaterThan(0);
    expect(activeLinkSourceCount).toBe(0);
    expect(container.querySelector(".cm-content")).toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeInTheDocument();
  });
});
