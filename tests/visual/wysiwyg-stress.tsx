import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/App.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      convertFileSrc: (filePath: string) => string;
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      transformCallback: (callback: unknown) => number;
      unregisterCallback: (id: number) => void;
    };
    __wysiwygStressResult?: StressResult;
    __wysiwygStressSource?: string;
  }
}

interface StressResult {
  status: "idle" | "running" | "passed" | "failed";
  mountMs: number;
  opsMs: number;
  lineCount: number;
  tableCount: number;
  codeBlockCount: number;
  contentLength: number;
  activeLinkSourceCount?: number;
  error?: string;
}

window.__TAURI_INTERNALS__ = {
  convertFileSrc: (filePath: string) => filePath,
  invoke: async () => null,
  transformCallback: () => Math.floor(Math.random() * 1_000_000),
  unregisterCallback: () => {},
};

const { MarkdownWysiwygEditor } = await import("../../src/components/Editor/MarkdownWysiwygEditor");
const { useEditorStore } = await import("../../src/stores/editorStore");

function makeStressMarkdown(sections: number): string {
  const parts = ["---", "title: Browser Visual Stress", "draft: true", "---", ""];
  for (let i = 0; i < sections; i++) {
    parts.push(
      `# Browser Section ${i}`,
      "",
      `Paragraph ${i} with **bold**, _italic_, [link](https://example.com/${i}), @paper${i}, and inline code \`x_${i}\`.`,
      "",
      "- [ ] Fast checkbox",
      "- [x] Done checkbox",
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

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function StressHarness() {
  const [result, setResult] = useState<StressResult>({
    status: "idle",
    mountMs: 0,
    opsMs: 0,
    lineCount: 0,
    tableCount: 0,
    codeBlockCount: 0,
    contentLength: 0,
  });

  useEffect(() => {
    const path = "/visual/wysiwyg-stress.md";
    const startedAt = performance.now();

    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useEditorStore.setState({
      editorFontSize: 14,
      editorWidth: 960,
      theme: "dark",
      workspacePath: "/visual",
      references: Array.from({ length: 160 }, (_, i) => ({
        id: `ref-${i}`,
        name: `paper-${i}.pdf`,
        kind: "pdf" as const,
        bibKey: `paper${i}`,
        title: `Paper ${i}`,
        addedAt: i,
      })),
    });
    useEditorStore.getState().openTab(path, "wysiwyg-stress.md", makeStressMarkdown(120));

    const run = async () => {
      try {
        setResult((prev) => ({ ...prev, status: "running" }));
        await nextFrame();
        await nextFrame();
        const mountMs = performance.now() - startedAt;

        const content = document.querySelector(".cm-content") as HTMLElement | null;
        const scroller = document.querySelector(".cm-scroller") as HTMLElement | null;
        if (!content || !scroller) throw new Error("Editor did not render");

        const opsStart = performance.now();
        for (let i = 0; i < 180; i++) {
          const richSnippet = i % 20 === 0
            ? `\n\n| Burst | Value |\n| --- | --- |\n| ${i} | ${i + 1} |\n\n\`\`\`ts\nconst burst${i} = ${i};\n\`\`\`\n`
            : "";
          window.dispatchEvent(new CustomEvent("editor:insert", {
            detail: `\nBrowser burst ${i}: **bold** _italic_ \`code\` [link](https://example.com/${i})${richSnippet}`,
          }));

          if (i % 8 === 0) {
            content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 60, clientY: 28, button: 0 }));
            content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 280, clientY: 28, button: 0 }));
          }
          if (i % 12 === 0) {
            scroller.scrollTop = i * 24;
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
          if (i % 30 === 0) await nextFrame();
        }
        await nextFrame();

        const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
        const nextResult: StressResult = {
          status: "passed",
          mountMs,
          opsMs: performance.now() - opsStart,
          lineCount: document.querySelectorAll(".cm-line").length,
          tableCount: document.querySelectorAll(".cm-md-table-render").length,
          codeBlockCount: document.querySelectorAll(".cm-md-code-block-line").length,
          contentLength: tab?.content.length ?? 0,
          activeLinkSourceCount: document.querySelectorAll(".cm-md-active-link-marker").length,
        };

        if (!tab?.content.includes("Browser burst 179")) {
          throw new Error("Final high-frequency insert was not persisted");
        }
        if (nextResult.activeLinkSourceCount) {
          throw new Error("Inactive boundary link source markers remained visible");
        }
        if (nextResult.lineCount < 30 || nextResult.tableCount < 1 || nextResult.codeBlockCount < 1) {
          throw new Error("Rendered editor DOM collapsed under pressure");
        }

        window.__wysiwygStressSource = tab?.content ?? "";
        window.__wysiwygStressResult = nextResult;
        setResult(nextResult);
      } catch (error) {
        const failed: StressResult = {
          status: "failed",
          mountMs: 0,
          opsMs: 0,
          lineCount: document.querySelectorAll(".cm-line").length,
          tableCount: document.querySelectorAll(".cm-md-table-render").length,
          codeBlockCount: document.querySelectorAll(".cm-md-code-block-line").length,
          contentLength: useEditorStore.getState().activeTab()?.content.length ?? 0,
          activeLinkSourceCount: document.querySelectorAll(".cm-md-active-link-marker").length,
          error: error instanceof Error ? error.message : String(error),
        };
        window.__wysiwygStressResult = failed;
        setResult(failed);
      }
    };

    void run();
  }, []);

  return (
    <div className="visual-stress-shell">
      <div className="visual-stress-header">
        <strong>WYSIWYG Visual Stress</strong>
        <span data-status={result.status}>{result.status}</span>
        <span>mount {result.mountMs.toFixed(1)}ms</span>
        <span>ops {result.opsMs.toFixed(1)}ms</span>
        <span>lines {result.lineCount}</span>
        <span>tables {result.tableCount}</span>
        <span>code {result.codeBlockCount}</span>
        {result.error && <span className="visual-stress-error">{result.error}</span>}
      </div>
      <MarkdownWysiwygEditor />
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  body { background: #111; color: #eee; overflow: hidden; }
  .visual-stress-shell { height: 100%; display: grid; grid-template-rows: 42px 1fr; }
  .visual-stress-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    border-bottom: 1px solid rgba(255,255,255,.12);
    font: 13px ui-sans-serif, system-ui, sans-serif;
    background: #181818;
  }
  .visual-stress-header [data-status="passed"] { color: #7ddc92; }
  .visual-stress-header [data-status="failed"] { color: #ff8a8a; }
  .visual-stress-error { color: #ff8a8a; }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(<StressHarness />);
