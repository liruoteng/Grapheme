import { beforeEach, describe, expect, it } from "vitest";
import {
  getAllTools,
  getToolByName,
  getToolsForPhase,
  getToolPromptSummary,
  clearAllToolState,
} from "./index";

describe("tool registry", () => {
  beforeEach(() => {
    clearAllToolState();
  });

  it("returns all four tools", () => {
    expect(getAllTools()).toHaveLength(4);
  });

  it("finds a tool by name", () => {
    expect(getToolByName("Citation")?.name).toBe("Citation");
    expect(getToolByName("LiteratureSearch")?.name).toBe("LiteratureSearch");
    expect(getToolByName("Outline")?.name).toBe("Outline");
    expect(getToolByName("SectionDraft")?.name).toBe("SectionDraft");
  });

  it("returns undefined for an unknown tool name", () => {
    expect(getToolByName("Nonexistent")).toBeUndefined();
  });

  it("returns the correct tools for the research phase", () => {
    const tools = getToolsForPhase("research");
    expect(tools.map((t) => t.name)).toEqual(["LiteratureSearch", "Citation"]);
  });

  it("returns the correct tools for the outlining phase", () => {
    const tools = getToolsForPhase("outlining");
    expect(tools.map((t) => t.name)).toEqual(["Outline", "LiteratureSearch"]);
  });

  it("returns the correct tools for the drafting phase", () => {
    const tools = getToolsForPhase("drafting");
    expect(tools.map((t) => t.name)).toEqual([
      "SectionDraft",
      "Citation",
      "LiteratureSearch",
    ]);
  });

  it("returns the correct tools for the reviewing phase", () => {
    const tools = getToolsForPhase("reviewing");
    expect(tools.map((t) => t.name)).toEqual(["SectionDraft", "Citation"]);
  });

  it("returns the correct tools for the polishing phase", () => {
    const tools = getToolsForPhase("polishing");
    expect(tools.map((t) => t.name)).toEqual(["SectionDraft"]);
  });

  it("generates a prompt summary from tools", () => {
    const summary = getToolPromptSummary(getAllTools());
    expect(summary).toContain("**Citation**");
    expect(summary).toContain("**LiteratureSearch**");
    expect(summary).toContain("**Outline**");
    expect(summary).toContain("**SectionDraft**");
  });

  it("clears all tool state without error", () => {
    expect(() => clearAllToolState()).not.toThrow();
  });
});
