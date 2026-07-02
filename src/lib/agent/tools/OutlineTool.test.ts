import { beforeEach, describe, expect, it } from "vitest";
import { OutlineTool, clearOutline } from "./OutlineTool";
import type { OutlineNode } from "../types";

const ctx = {};

function node(id: string, title: string, level = 1): OutlineNode {
  return { id, title, level, children: [] };
}

describe("OutlineTool", () => {
  beforeEach(() => {
    clearOutline();
  });

  it("has correct metadata", () => {
    expect(OutlineTool.name).toBe("Outline");
    expect(OutlineTool.isReadOnly({ action: "get" })).toBe(true);
    expect(OutlineTool.isReadOnly({ action: "set" })).toBe(false);
  });

  it("sets the entire outline", async () => {
    const nodes = [node("1", "Introduction"), node("2", "Methods")];
    const result = await OutlineTool.call({ action: "set", nodes }, ctx);
    expect(result.data.outline).toHaveLength(2);
    expect(result.data.message).toContain("2 top-level sections");
  });

  it("gets the current outline", async () => {
    await OutlineTool.call(
      { action: "set", nodes: [node("1", "Intro")] },
      ctx,
    );
    const result = await OutlineTool.call({ action: "get" }, ctx);
    expect(result.data.outline).toHaveLength(1);
    expect(result.data.outline[0].title).toBe("Intro");
  });

  it("adds a top-level node", async () => {
    const result = await OutlineTool.call(
      { action: "add", title: "Results", nodeId: "r1" },
      ctx,
    );
    expect(result.data.outline).toHaveLength(1);
    expect(result.data.outline[0].id).toBe("r1");
    expect(result.data.message).toBe("Added: Results");
  });

  it("adds a child node under a parent", async () => {
    await OutlineTool.call(
      { action: "set", nodes: [node("p1", "Parent")] },
      ctx,
    );
    const result = await OutlineTool.call(
      { action: "add", title: "Child", parentId: "p1", nodeId: "c1" },
      ctx,
    );
    expect(result.data.outline[0].children).toHaveLength(1);
    expect(result.data.outline[0].children[0].id).toBe("c1");
  });

  it("returns an error when add is missing title", async () => {
    const result = await OutlineTool.call({ action: "add" }, ctx);
    expect(result.error).toBe("title is required");
  });

  it("removes a node by id", async () => {
    await OutlineTool.call(
      { action: "set", nodes: [node("1", "A"), node("2", "B")] },
      ctx,
    );
    const result = await OutlineTool.call(
      { action: "remove", nodeId: "1" },
      ctx,
    );
    expect(result.data.outline).toHaveLength(1);
    expect(result.data.outline[0].id).toBe("2");
    expect(result.data.message).toBe("Node removed");
  });

  it("removes a nested child node", async () => {
    const parent: OutlineNode = {
      id: "p",
      title: "Parent",
      level: 1,
      children: [node("c1", "Child1"), node("c2", "Child2")],
    };
    await OutlineTool.call({ action: "set", nodes: [parent] }, ctx);
    const result = await OutlineTool.call(
      { action: "remove", nodeId: "c1" },
      ctx,
    );
    expect(result.data.outline[0].children).toHaveLength(1);
    expect(result.data.outline[0].children[0].id).toBe("c2");
  });

  it("returns an error when remove is missing nodeId", async () => {
    const result = await OutlineTool.call({ action: "remove" }, ctx);
    expect(result.error).toBe("nodeId is required");
  });

  it("defaults level to 1 and generates an id when not provided", async () => {
    const result = await OutlineTool.call(
      { action: "add", title: "Auto" },
      ctx,
    );
    expect(result.data.outline[0].level).toBe(1);
    expect(result.data.outline[0].id).toMatch(/^out_/);
  });

  it("returns a prompt string", () => {
    expect(OutlineTool.prompt()).toContain("Outline");
  });
});
