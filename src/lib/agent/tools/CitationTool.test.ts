import { beforeEach, describe, expect, it } from "vitest";
import { CitationTool, clearCitationStore } from "./CitationTool";

const ctx = {};

describe("CitationTool", () => {
  beforeEach(() => {
    clearCitationStore();
  });

  it("has correct metadata", () => {
    expect(CitationTool.name).toBe("Citation");
    expect(CitationTool.description).toBeTruthy();
    expect(CitationTool.inputSchema.required).toEqual(["action"]);
  });

  it("reports read-only for list and format", () => {
    expect(CitationTool.isReadOnly({ action: "list" })).toBe(true);
    expect(CitationTool.isReadOnly({ action: "format" })).toBe(true);
    expect(CitationTool.isReadOnly({ action: "add" })).toBe(false);
    expect(CitationTool.isReadOnly({ action: "remove" })).toBe(false);
  });

  it("adds a citation with auto-generated bibKey", async () => {
    const result = await CitationTool.call(
      {
        action: "add",
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani", "Noam Shazeer"],
        year: 2017,
      },
      ctx,
    );
    expect(result.error).toBeUndefined();
    expect(result.data.action).toBe("add");
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.entries[0].bibKey).toBe("vaswani2017");
    expect(result.data.entries[0].bibEntry).toContain("@article{vaswani2017");
    expect(result.data.message).toContain("Added @vaswani2017");
  });

  it("adds a citation with a custom bibKey and doi", async () => {
    const result = await CitationTool.call(
      {
        action: "add",
        bibKey: "custom2024",
        title: "Test Paper",
        authors: ["Alice"],
        year: 2024,
        doi: "10.1000/test",
      },
      ctx,
    );
    expect(result.data.entries[0].bibKey).toBe("custom2024");
    expect(result.data.entries[0].bibEntry).toContain("doi = {10.1000/test}");
  });

  it("returns an error when add is missing required fields", async () => {
    const result = await CitationTool.call({ action: "add" }, ctx);
    expect(result.error).toBe("title, authors, and year are required");
    expect(result.data.entries).toHaveLength(0);
  });

  it("returns an error when add has title but no authors", async () => {
    const result = await CitationTool.call(
      { action: "add", title: "X", authors: [], year: 2020 },
      ctx,
    );
    expect(result.error).toBe("title, authors, and year are required");
  });

  it("removes a citation by bibKey", async () => {
    await CitationTool.call(
      {
        action: "add",
        title: "Paper",
        authors: ["Smith"],
        year: 2020,
      },
      ctx,
    );
    const result = await CitationTool.call(
      { action: "remove", bibKey: "smith2020" },
      ctx,
    );
    expect(result.data.message).toBe("Removed @smith2020");

    const list = await CitationTool.call({ action: "list" }, ctx);
    expect(list.data.entries).toHaveLength(0);
  });

  it("returns not found when removing a nonexistent bibKey", async () => {
    const result = await CitationTool.call(
      { action: "remove", bibKey: "nope" },
      ctx,
    );
    expect(result.data.message).toBe("Not found");
  });

  it("returns an error when remove is missing bibKey", async () => {
    const result = await CitationTool.call({ action: "remove" }, ctx);
    expect(result.error).toBe("bibKey is required");
  });

  it("lists all citations", async () => {
    await CitationTool.call(
      { action: "add", title: "A", authors: ["X"], year: 2020 },
      ctx,
    );
    await CitationTool.call(
      { action: "add", title: "B", authors: ["Y"], year: 2021 },
      ctx,
    );
    const result = await CitationTool.call({ action: "list" }, ctx);
    expect(result.data.entries).toHaveLength(2);
  });

  it("formats all citations as BibTeX", async () => {
    await CitationTool.call(
      { action: "add", title: "A", authors: ["X"], year: 2020 },
      ctx,
    );
    await CitationTool.call(
      { action: "add", title: "B", authors: ["Y"], year: 2021 },
      ctx,
    );
    const result = await CitationTool.call({ action: "format" }, ctx);
    expect(result.data.formatted).toContain("@article{x2020");
    expect(result.data.formatted).toContain("@article{y2021");
  });

  it("returns a prompt string", () => {
    expect(CitationTool.prompt()).toContain("Citation");
  });
});
