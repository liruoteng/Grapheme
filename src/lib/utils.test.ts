import { describe, it, expect } from "vitest";
import {
  extractOutline,
  formatOutlineForContext,
  formatReferencesForContext,
  formatTabsForContext,
} from "./utils";

describe("extractOutline", () => {
  it("extracts markdown headings", () => {
    const result = extractOutline("# Title\n\n## Section\n\n### Subsection\n\nBody text");
    expect(result).toEqual([
      { level: 1, title: "Title", line: 1 },
      { level: 2, title: "Section", line: 3 },
      { level: 3, title: "Subsection", line: 5 },
    ]);
  });

  it("extracts typst headings", () => {
    const result = extractOutline("= Title\n\n== Section\n\n=== Subsection");
    expect(result).toEqual([
      { level: 1, title: "Title", line: 1 },
      { level: 2, title: "Section", line: 3 },
      { level: 3, title: "Subsection", line: 5 },
    ]);
  });

  it("mixes markdown and typst headings", () => {
    const result = extractOutline("# MD Title\n\n= Typst Title");
    expect(result).toEqual([
      { level: 1, title: "MD Title", line: 1 },
      { level: 1, title: "Typst Title", line: 3 },
    ]);
  });

  it("returns empty for content without headings", () => {
    expect(extractOutline("plain text\n\nno headings here")).toEqual([]);
  });

  it("returns empty for empty content", () => {
    expect(extractOutline("")).toEqual([]);
  });

  it("trims heading text", () => {
    const result = extractOutline("#   spaced title   ");
    expect(result).toEqual([{ level: 1, title: "spaced title", line: 1 }]);
  });

  it("handles up to 6 markdown heading levels", () => {
    const result = extractOutline("###### Level 6");
    expect(result).toEqual([{ level: 6, title: "Level 6", line: 1 }]);
  });
});

describe("formatOutlineForContext", () => {
  it("formats outline as indented list", () => {
    const outline = [
      { level: 1, title: "Title", line: 1 },
      { level: 2, title: "Section", line: 3 },
      { level: 2, title: "Another Section", line: 5 },
    ];
    expect(formatOutlineForContext(outline)).toBe(
      "Document structure:\nTitle\n  Section\n  Another Section",
    );
  });

  it("filters by maxDepth default (3)", () => {
    const outline = [
      { level: 1, title: "H1", line: 1 },
      { level: 4, title: "H4", line: 3 },
    ];
    const result = formatOutlineForContext(outline);
    expect(result).toContain("H1");
    expect(result).not.toContain("H4");
  });

  it("filters by custom maxDepth", () => {
    const outline = [
      { level: 1, title: "H1", line: 1 },
      { level: 2, title: "H2", line: 3 },
      { level: 3, title: "H3", line: 5 },
    ];
    expect(formatOutlineForContext(outline, 1)).toBe("Document structure:\nH1");
  });

  it("returns empty string for empty outline", () => {
    expect(formatOutlineForContext([])).toBe("");
  });

  it("returns empty string when all items filtered out", () => {
    const outline = [{ level: 5, title: "Deep", line: 1 }];
    expect(formatOutlineForContext(outline, 3)).toBe("");
  });
});

describe("formatReferencesForContext", () => {
  it("formats refs with bibKey, title, authors, year", () => {
    const refs = [
      { bibKey: "smith2024", title: "A Paper", authors: ["John Smith"], year: 2024 },
    ];
    expect(formatReferencesForContext(refs)).toContain(
      "@smith2024: A Paper — John Smith (2024)",
    );
  });

  it("filters entries without bibKey", () => {
    const refs: Parameters<typeof formatReferencesForContext>[0] = [
      { title: "No key" },
      { bibKey: "key1", title: "Has key" },
    ];
    const result = formatReferencesForContext(refs);
    expect(result).toContain("@key1");
    expect(result).not.toContain("No key");
  });

  it("returns empty string for empty refs", () => {
    expect(formatReferencesForContext([])).toBe("");
  });

  it("truncates to first 3 authors with et al.", () => {
    const refs = [
      {
        bibKey: "many2023",
        title: "Many Authors",
        authors: ["A", "B", "C", "D"],
        year: 2023,
      },
    ];
    expect(formatReferencesForContext(refs)).toContain("A, B, C et al. (2023)");
  });

  it("handles missing title", () => {
    const refs = [{ bibKey: "no-title" }];
    expect(formatReferencesForContext(refs)).toContain("(no title)");
  });

  it("handles missing authors and year", () => {
    const refs = [{ bibKey: "minimal", title: "Minimal" }];
    expect(formatReferencesForContext(refs)).toContain("@minimal: Minimal");
  });
});

describe("formatTabsForContext", () => {
  it("formats tabs excluding active tab", () => {
    const tabs = [
      { path: "/a", name: "a.typ", content: "file a content" },
      { path: "/b", name: "b.typ", content: "file b content" },
    ];
    const result = formatTabsForContext(tabs, "/a");
    expect(result).toContain("b.typ");
    expect(result).toContain("file b content");
    expect(result).not.toContain("a.typ");
    expect(result).not.toContain("file a content");
  });

  it("returns empty string when only active tab exists", () => {
    const tabs = [{ path: "/a", name: "a.typ", content: "aaa" }];
    expect(formatTabsForContext(tabs, "/a")).toBe("");
  });

  it("returns empty string for empty tabs", () => {
    expect(formatTabsForContext([], null)).toBe("");
  });

  it("truncates long content with ellipsis", () => {
    const tabs = [{ path: "/b", name: "b.typ", content: "x".repeat(1000) }];
    const result = formatTabsForContext(tabs, "/a", 10);
    expect(result).toContain("x".repeat(10) + "...");
  });

  it("does not truncate content within maxCharsPerFile", () => {
    const tabs = [{ path: "/b", name: "b.typ", content: "short content" }];
    const result = formatTabsForContext(tabs, "/a", 500);
    expect(result).toContain("short content");
    expect(result).not.toContain("...");
  });
});
