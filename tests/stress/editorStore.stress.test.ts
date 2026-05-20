import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractOutline, formatTabsForContext } from "../../src/lib/utils";
import { useEditorStore, type Reference } from "../../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));

const MAX_STORE_CHURN_MS = Number(import.meta.env.STRESS_MAX_STORE_CHURN_MS ?? 2_500);
const MAX_CONTEXT_MS = Number(import.meta.env.STRESS_MAX_CONTEXT_MS ?? 1_500);
const MAX_OUTLINE_MS = Number(import.meta.env.STRESS_MAX_OUTLINE_MS ?? 1_500);

function makeMarkdown(sectionCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sectionCount; i++) {
    parts.push(
      `# Section ${i}`,
      "",
      `Paragraph ${i} with math $\\alpha_${i} + \\frac{1}{2}$ and citation @paper${i}.`,
      "",
      "| A | B | C |",
      "| --- | --- | --- |",
      `| ${i} | ${i + 1} | ${i + 2} |`,
      "",
      "```typst",
      `#let value${i} = ${i}`,
      "```",
      "",
    );
  }
  return parts.join("\n");
}

function makeRefs(count: number): Reference[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ref-${i}`,
    name: `paper-${i}.pdf`,
    kind: "pdf" as const,
    path: `/papers/paper-${i}.pdf`,
    bibKey: `paper${i}`,
    title: `Stress Paper ${i}`,
    authors: ["Ada Lovelace", "Grace Hopper", "Katherine Johnson", "Barbara Liskov"],
    year: 2020 + (i % 7),
    addedAt: i,
  }));
}

function expectWithinBudget(label: string, durationMs: number, maxMs: number) {
  console.log(`[stress] ${label}: ${durationMs.toFixed(1)}ms / ${maxMs}ms`);
  expect(durationMs).toBeLessThan(maxMs);
}

describe("editor store stress", () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("handles repeated large-tab edits and preview updates", () => {
    const base = makeMarkdown(120);
    const store = useEditorStore.getState();
    const startedAt = performance.now();

    for (let i = 0; i < 40; i++) {
      store.openTab(`/stress/doc-${i}.md`, `doc-${i}.md`, `${base}\n\n<!-- tab ${i} -->`);
    }

    for (let i = 0; i < 1_000; i++) {
      const path = `/stress/doc-${i % 40}.md`;
      useEditorStore.getState().setActiveTab(path);
      useEditorStore.getState().updateTabContent(path, `${base}\n\nEdit ${i}`);
      useEditorStore.getState().markTabClean(path);
    }

    for (let round = 0; round < 30; round++) {
      useEditorStore.getState().applyPreviewUpdate(
        120,
        Array.from({ length: 20 }, (_, i) => ({
          index: (round + i) % 120,
          svg: `<svg data-round="${round}" data-page="${i}"><text>${round}-${i}</text></svg>`,
        })),
      );
    }

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(40);
    expect(state.tabs.every((tab) => !tab.isDirty)).toBe(true);
    expect(state.previewPages).toHaveLength(120);
    expect(state.previewError).toBeNull();
    expect(state.compileStatus).toBe("success");

    expectWithinBudget("store churn", performance.now() - startedAt, MAX_STORE_CHURN_MS);
  });

  it("builds AI context from many open files and references", () => {
    const activeContent = makeMarkdown(250);
    const otherContent = makeMarkdown(80);

    useEditorStore.setState({
      tabs: [
        { path: "/stress/active.md", name: "active.md", content: activeContent, isDirty: false },
        ...Array.from({ length: 60 }, (_, i) => ({
          path: `/stress/other-${i}.md`,
          name: `other-${i}.md`,
          content: `${otherContent}\n\nOther file ${i}`,
          isDirty: false,
        })),
      ],
      activeTabPath: "/stress/active.md",
      references: makeRefs(500),
    });

    const startedAt = performance.now();
    const context = useEditorStore.getState().getAiContext();

    expect(context).toContain("Document structure:");
    expect(context).toContain("Available references:");
    expect(context).toContain("Other open files:");
    expect(context).toContain("File: other-0.md");
    expect(context.length).toBeLessThan(60 * 700 + 80_000);

    expectWithinBudget("AI context", performance.now() - startedAt, MAX_CONTEXT_MS);
  });

  it("extracts and formats outlines for a very large document", () => {
    const content = makeMarkdown(4_000);
    const startedAt = performance.now();
    const outline = extractOutline(content);
    const formattedTabs = formatTabsForContext(
      Array.from({ length: 100 }, (_, i) => ({
        path: `/stress/tab-${i}.md`,
        name: `tab-${i}.md`,
        content,
      })),
      "/stress/tab-0.md",
    );

    expect(outline).toHaveLength(4_000);
    expect(outline[0]).toEqual({ level: 1, title: "Section 0", line: 1 });
    expect(formattedTabs).toContain("Other open files:");
    expect(formattedTabs.length).toBeLessThan(70_000);

    expectWithinBudget("outline and tab context", performance.now() - startedAt, MAX_OUTLINE_MS);
  });
});
