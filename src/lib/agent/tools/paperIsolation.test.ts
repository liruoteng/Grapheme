import { afterEach, describe, expect, it } from "vitest";
import { SectionDraftTool } from "./SectionDraftTool";
import { CitationTool } from "./CitationTool";
import { OutlineTool } from "./OutlineTool";
import { clearAllToolState } from "./index";

afterEach(clearAllToolState);

describe("paper tool state", () => {
  it("keeps sections, citations, and outlines separate for different papers", async () => {
    const one = { paperId: "one" };
    const two = { paperId: "two" };
    await SectionDraftTool.call({ action: "create", sectionId: "intro", title: "Private draft", content: "First manuscript" }, one);
    await CitationTool.call({ action: "add", title: "First citation", authors: ["A Author"], year: 2026 }, one);
    await OutlineTool.call({ action: "add", title: "First outline" }, one);
    expect((await SectionDraftTool.call({ action: "list" }, two)).data.sections).toEqual([]);
    expect((await CitationTool.call({ action: "list" }, two)).data.entries).toEqual([]);
    expect((await OutlineTool.call({ action: "get" }, two)).data.outline).toEqual([]);
    expect((await SectionDraftTool.call({ action: "update", sectionId: "intro", content: "Unexpected write" }, two)).error).toContain("not found");
    expect((await SectionDraftTool.call({ action: "get", sectionId: "intro" }, one)).data.sections[0].content).toBe("First manuscript");
  });
});
