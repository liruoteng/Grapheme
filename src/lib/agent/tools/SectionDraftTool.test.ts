import { beforeEach, describe, expect, it } from "vitest";
import { SectionDraftTool, clearSectionStore } from "./SectionDraftTool";

const ctx = {};

describe("SectionDraftTool", () => {
  beforeEach(() => {
    clearSectionStore();
  });

  it("has correct metadata", () => {
    expect(SectionDraftTool.name).toBe("SectionDraft");
    expect(SectionDraftTool.isReadOnly({ action: "get" })).toBe(true);
    expect(SectionDraftTool.isReadOnly({ action: "list" })).toBe(true);
    expect(SectionDraftTool.isReadOnly({ action: "create" })).toBe(false);
    expect(SectionDraftTool.isReadOnly({ action: "update" })).toBe(false);
  });

  it("creates a section with default level and pending status", async () => {
    const result = await SectionDraftTool.call(
      { action: "create", title: "Introduction" },
      ctx,
    );
    expect(result.error).toBeUndefined();
    expect(result.data.sections).toHaveLength(1);
    expect(result.data.sections[0].title).toBe("Introduction");
    expect(result.data.sections[0].level).toBe(1);
    expect(result.data.sections[0].status).toBe("pending");
    expect(result.data.sections[0].content).toBe("");
    expect(result.data.message).toContain("Created section: Introduction");
  });

  it("creates a section with content and drafting status", async () => {
    const result = await SectionDraftTool.call(
      { action: "create", title: "Methods", content: "Some content", level: 2, parentId: "p1" },
      ctx,
    );
    expect(result.data.sections[0].status).toBe("drafting");
    expect(result.data.sections[0].content).toBe("Some content");
    expect(result.data.sections[0].level).toBe(2);
    expect(result.data.sections[0].parentId).toBe("p1");
  });

  it("creates a section with a custom id", async () => {
    const result = await SectionDraftTool.call(
      { action: "create", title: "X", sectionId: "custom-id" },
      ctx,
    );
    expect(result.data.sections[0].id).toBe("custom-id");
  });

  it("returns an error when create is missing title", async () => {
    const result = await SectionDraftTool.call({ action: "create" }, ctx);
    expect(result.error).toBe("title is required");
    expect(result.data.sections).toHaveLength(0);
  });

  it("updates an existing section", async () => {
    const created = await SectionDraftTool.call(
      { action: "create", title: "Intro", sectionId: "s1" },
      ctx,
    );
    expect(created.data.sections[0].status).toBe("pending");

    const result = await SectionDraftTool.call(
      { action: "update", sectionId: "s1", content: "Updated content" },
      ctx,
    );
    expect(result.data.sections[0].content).toBe("Updated content");
    expect(result.data.sections[0].title).toBe("Intro");
    expect(result.data.sections[0].status).toBe("drafting");
    expect(result.data.message).toContain("Updated section: Intro");
  });

  it("updates title while preserving content", async () => {
    await SectionDraftTool.call(
      { action: "create", title: "Old", sectionId: "s1", content: "text" },
      ctx,
    );
    const result = await SectionDraftTool.call(
      { action: "update", sectionId: "s1", title: "New" },
      ctx,
    );
    expect(result.data.sections[0].title).toBe("New");
    expect(result.data.sections[0].content).toBe("text");
  });

  it("returns an error when update is missing sectionId", async () => {
    const result = await SectionDraftTool.call({ action: "update" }, ctx);
    expect(result.error).toBe("sectionId is required");
  });

  it("returns an error when updating a nonexistent section", async () => {
    const result = await SectionDraftTool.call(
      { action: "update", sectionId: "nope" },
      ctx,
    );
    expect(result.error).toContain("not found");
  });

  it("gets a section by id", async () => {
    await SectionDraftTool.call(
      { action: "create", title: "Intro", sectionId: "s1" },
      ctx,
    );
    const result = await SectionDraftTool.call(
      { action: "get", sectionId: "s1" },
      ctx,
    );
    expect(result.data.sections).toHaveLength(1);
    expect(result.data.sections[0].id).toBe("s1");
  });

  it("returns an error when get is missing sectionId", async () => {
    const result = await SectionDraftTool.call({ action: "get" }, ctx);
    expect(result.error).toBe("sectionId is required");
  });

  it("returns an error when getting a nonexistent section", async () => {
    const result = await SectionDraftTool.call(
      { action: "get", sectionId: "nope" },
      ctx,
    );
    expect(result.error).toContain("not found");
  });

  it("lists all sections sorted by level then title", async () => {
    await SectionDraftTool.call(
      { action: "create", title: "Zeta", sectionId: "s1", level: 2 },
      ctx,
    );
    await SectionDraftTool.call(
      { action: "create", title: "Alpha", sectionId: "s2", level: 1 },
      ctx,
    );
    await SectionDraftTool.call(
      { action: "create", title: "Beta", sectionId: "s3", level: 1 },
      ctx,
    );
    const result = await SectionDraftTool.call({ action: "list" }, ctx);
    expect(result.data.sections.map((s) => s.title)).toEqual([
      "Alpha",
      "Beta",
      "Zeta",
    ]);
  });

  it("returns a prompt string", () => {
    expect(SectionDraftTool.prompt()).toContain("SectionDraft");
  });
});
