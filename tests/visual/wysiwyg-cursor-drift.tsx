import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
    __cursorDriftPrepareTarget?: (name: string) => Promise<CursorDriftPoint | null>;
    __cursorDriftRecordClick?: (name: string) => CursorDriftReport;
    __cursorDriftRun?: () => Promise<CursorDriftReport>;
    __cursorDriftReport?: CursorDriftReport;
  }
}

type CursorDriftPoint = {
  name: string;
  token: string;
  expectedLine: number;
  roundtripLine: number | null;
  clickX: number;
  clickY: number;
  hitTarget: string;
  lineHeight: number;
  error?: string;
};

type CursorDriftCase = CursorDriftPoint & {
  actualLine: number | null;
  driftX: number | null;
  driftY: number | null;
  passed: boolean;
};

type CursorDriftReport = {
  status: "idle" | "running" | "ready" | "passed" | "failed";
  cases: CursorDriftCase[];
  maxAbsDriftY: number;
  error?: string;
};

type Target = {
  name: string;
  token: string;
};

window.__TAURI_INTERNALS__ = {
  convertFileSrc: (filePath: string) => filePath,
  invoke: async () => null,
  transformCallback: () => Math.floor(Math.random() * 1_000_000),
  unregisterCallback: () => {},
};

const { MarkdownWysiwygEditor } = await import("../../src/components/Editor/MarkdownWysiwygEditor");
const { useEditorStore } = await import("../../src/stores/editorStore");

const source = [
  "# Cursor Drift Harness",
  "",
  "plain-before-rule-token alpha beta gamma",
  "***",
  "after-rule-first-token should be clickable",
  "before-math-second-token should also be clickable",
  "## Math (if supported)",
  "",
  "inline-math-token before $E = m c^2$ after",
  "",
  "$$",
  "E = m c^2",
  "$$",
  "",
  "## Heading Offset Probe",
  "",
  "> blockquote-token should map to this quote line",
  "",
  "* list-item-token should map to this bullet line",
  "",
  "wrap-start-token This sentence is intentionally long enough to wrap at narrower editor widths and still keep wrap-end-token available for cursor drift measurement across visual line fragments.",
  "",
  "| A | B |",
  "| --- | --- |",
  "| table-token | cell |",
  "",
  "```ts",
  "const codeToken = 'code-block-token';",
  "```",
  "",
].join("\n");

const targets: Target[] = [
  { name: "plain line before rendered rule", token: "plain-before-rule-token" },
  { name: "first line after rendered rule", token: "after-rule-first-token" },
  { name: "line immediately above math heading", token: "before-math-second-token" },
  { name: "math heading text", token: "Math (if supported)" },
  { name: "inline math text line", token: "inline-math-token" },
  { name: "heading after math block", token: "Heading Offset Probe" },
  { name: "blockquote text", token: "blockquote-token" },
  { name: "list item text", token: "list-item-token" },
  { name: "wrapped line start", token: "wrap-start-token" },
  { name: "wrapped line end", token: "wrap-end-token" },
  { name: "rendered table text", token: "table-token" },
  { name: "code block text", token: "code-block-token" },
];

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function describeElement(element: Element | null) {
  if (!element) return "null";
  const classes = element instanceof HTMLElement ? element.className : "";
  return `${element.tagName.toLowerCase()}${classes ? `.${String(classes).replace(/\s+/g, ".")}` : ""}`;
}

function getEditorView() {
  const content = document.querySelector(".cm-content") as HTMLElement | null;
  const view = content ? EditorView.findFromDOM(content) : null;
  if (!content || !view) throw new Error("Editor did not render");
  return { content, view };
}

function findTokenPoint(root: HTMLElement, token: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const index = text.indexOf(token);
    if (index === -1) continue;

    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + token.length);

    const rect = [...range.getClientRects()].find((item) => item.width > 0 && item.height > 0)
      ?? range.getBoundingClientRect();
    range.detach();

    if (rect.width <= 0 || rect.height <= 0) continue;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      height: rect.height,
    };
  }

  return null;
}

async function prepareTarget(name: string): Promise<CursorDriftPoint | null> {
  await nextFrame();
  await nextFrame();

  const { content, view } = getEditorView();
  const target = targets.find((item) => item.name === name);
  if (!target) return null;

  view.dispatch({ selection: EditorSelection.cursor(0), scrollIntoView: false });
  await nextFrame();

  const tokenOffset = source.indexOf(target.token);
  const expectedPos = tokenOffset === -1 ? -1 : tokenOffset + Math.floor(target.token.length / 2);
  const expectedLine = expectedPos === -1 ? -1 : view.state.doc.lineAt(expectedPos).number;
  const point = findTokenPoint(content, target.token);

  if (!point || expectedPos === -1) {
    return {
      name: target.name,
      token: target.token,
      expectedLine,
      roundtripLine: null,
      clickX: 0,
      clickY: 0,
      hitTarget: "null",
      lineHeight: 0,
      error: "Could not find visible token point",
    };
  }

  const roundtripPos = view.posAtCoords({ x: point.x, y: point.y });
  const roundtripLine = roundtripPos === null ? null : view.state.doc.lineAt(roundtripPos).number;
  const hitTarget = document.elementFromPoint(point.x, point.y);

  return {
    name: target.name,
    token: target.token,
    expectedLine,
    roundtripLine,
    clickX: point.x,
    clickY: point.y,
    hitTarget: describeElement(hitTarget),
    lineHeight: point.height,
  };
}

function mergeCase(point: CursorDriftPoint, partial: Partial<CursorDriftCase>): CursorDriftCase {
  return {
    ...point,
    actualLine: null,
    driftX: null,
    driftY: null,
    passed: false,
    ...partial,
  };
}

function updateCase(nextCase: CursorDriftCase) {
  const previous = window.__cursorDriftReport ?? {
    status: "running" as const,
    cases: [],
    maxAbsDriftY: 0,
  };
  const cases = [
    ...previous.cases.filter((item) => item.name !== nextCase.name),
    nextCase,
  ].sort((a, b) => targets.findIndex((item) => item.name === a.name) - targets.findIndex((item) => item.name === b.name));
  const maxAbsDriftY = cases.reduce((max, item) => (
    item.driftY === null ? max : Math.max(max, Math.abs(item.driftY))
  ), 0);
  const prepared = cases.length === targets.length;
  const complete = prepared && cases.every((item) => item.actualLine !== null || item.error);
  const report = {
    status: complete && cases.every((item) => item.passed) ? "passed" : complete ? "failed" : prepared ? "ready" : "running",
    cases,
    maxAbsDriftY,
  };
  window.__cursorDriftReport = report;
  return report;
}

async function runCursorDriftProbe(): Promise<CursorDriftReport> {
  for (const target of targets) {
    const point = await prepareTarget(target.name);
    if (point?.error) {
      updateCase(mergeCase(point, { error: point.error, passed: false }));
    } else if (point) {
      updateCase(mergeCase(point, {
        passed: point.roundtripLine === point.expectedLine,
      }));
    }
  }

  return window.__cursorDriftReport ?? {
    status: "failed",
    cases: [],
    maxAbsDriftY: 0,
    error: "Probe did not produce a report",
  };
}

function recordClick(name: string): CursorDriftReport {
  const point = window.__cursorDriftReport?.cases.find((item) => item.name === name);
  if (!point) {
    return window.__cursorDriftReport ?? {
      status: "failed",
      cases: [],
      maxAbsDriftY: 0,
      error: `No prepared point for ${name}`,
    };
  }

  const { view } = getEditorView();
  const selection = view.state.selection.main;
  const actualLine = selection.empty ? view.state.doc.lineAt(selection.head).number : null;
  const cursorCoords = selection.empty ? view.coordsAtPos(selection.head) : null;
  const cursorY = cursorCoords ? (cursorCoords.top + cursorCoords.bottom) / 2 : null;
  const driftX = cursorCoords ? cursorCoords.left - point.clickX : null;
  const driftY = cursorY === null ? null : cursorY - point.clickY;
  const lineMatches = actualLine === point.expectedLine && point.roundtripLine === point.expectedLine;
  const yWithinLine = driftY !== null && Math.abs(driftY) <= Math.max(point.lineHeight, 12);

  return updateCase(mergeCase(point, {
    actualLine,
    driftX,
    driftY,
    passed: lineMatches && yWithinLine,
  }));
}

function CursorDriftHarness() {
  const [report, setReport] = useState<CursorDriftReport>({
    status: "idle",
    cases: [],
    maxAbsDriftY: 0,
  });

  useEffect(() => {
    const path = "/visual/wysiwyg-cursor-drift.md";

    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useEditorStore.setState({
      editorFontSize: 14,
      editorWidth: 720,
      theme: "dark",
      workspacePath: "/visual",
      references: [],
    });
    useEditorStore.getState().openTab(path, "wysiwyg-cursor-drift.md", source);

    window.__cursorDriftRun = async () => {
      setReport((prev) => ({ ...prev, status: "running" }));
      try {
        const nextReport = await runCursorDriftProbe();
        window.__cursorDriftReport = nextReport;
        setReport(nextReport);
        return nextReport;
      } catch (error) {
        const failed: CursorDriftReport = {
          status: "failed",
          cases: [],
          maxAbsDriftY: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        window.__cursorDriftReport = failed;
        setReport(failed);
        return failed;
      }
    };
    window.__cursorDriftPrepareTarget = async (name: string) => {
      const point = await prepareTarget(name);
      if (point) updateCase(mergeCase(point, { passed: point.roundtripLine === point.expectedLine }));
      setReport(window.__cursorDriftReport!);
      return point;
    };
    window.__cursorDriftRecordClick = (name: string) => {
      const nextReport = recordClick(name);
      setReport(nextReport);
      return nextReport;
    };

    void window.__cursorDriftRun();
  }, []);

  return (
    <div className="cursor-drift-shell">
      <div className="cursor-drift-header">
        <strong>WYSIWYG Cursor Drift</strong>
        <span data-status={report.status}>{report.status}</span>
        <span>max Y drift {report.maxAbsDriftY.toFixed(1)}px</span>
        {report.error && <span className="cursor-drift-error">{report.error}</span>}
      </div>
      <div className="cursor-drift-main">
        <MarkdownWysiwygEditor />
        <aside className="cursor-drift-report">
          {report.cases.map((item) => (
            <div className="cursor-drift-case" data-pass={item.passed ? "true" : "false"} key={item.name}>
              <strong>{item.name}</strong>
              <span>expected L{item.expectedLine}, click L{item.actualLine ?? "?"}, map L{item.roundtripLine ?? "?"}</span>
              <span>Y drift {item.driftY === null ? "?" : `${item.driftY.toFixed(1)}px`}</span>
              <span>{item.hitTarget}</span>
              {item.error && <span>{item.error}</span>}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  body { background: #111; color: #eee; overflow: hidden; }
  .cursor-drift-shell { height: 100%; display: grid; grid-template-rows: 42px 1fr; }
  .cursor-drift-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    border-bottom: 1px solid rgba(255,255,255,.12);
    font: 13px ui-sans-serif, system-ui, sans-serif;
    background: #181818;
  }
  .cursor-drift-header [data-status="passed"] { color: #7ddc92; }
  .cursor-drift-header [data-status="ready"] { color: #f1d27a; }
  .cursor-drift-header [data-status="failed"] { color: #ff8a8a; }
  .cursor-drift-error { color: #ff8a8a; }
  .cursor-drift-main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
  }
  .cursor-drift-report {
    overflow: auto;
    border-left: 1px solid rgba(255,255,255,.12);
    background: #181818;
    font: 12px ui-sans-serif, system-ui, sans-serif;
  }
  .cursor-drift-case {
    display: grid;
    gap: 3px;
    padding: 9px 12px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    color: #cfcfcf;
  }
  .cursor-drift-case[data-pass="false"] { color: #ffaaaa; }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(<CursorDriftHarness />);
