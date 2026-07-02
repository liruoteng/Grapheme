import { describe, expect, it } from "vitest";
import { buildTool } from "./buildTool";

describe("buildTool", () => {
  const baseDef = {
    name: "TestTool",
    description: "A test tool",
    inputSchema: { type: "object", properties: { foo: { type: "string" } } },
    call: async (input: Record<string, unknown>) => ({ data: input }),
  };

  it("creates a tool with the correct name and description", () => {
    const tool = buildTool(baseDef);
    expect(tool.name).toBe("TestTool");
    expect(tool.description).toBe("A test tool");
  });

  it("preserves the input schema", () => {
    const tool = buildTool(baseDef);
    expect(tool.inputSchema).toEqual(baseDef.inputSchema);
  });

  it("calls the underlying call function", async () => {
    const tool = buildTool(baseDef);
    const result = await tool.call({ foo: "bar" }, {});
    expect(result.data).toEqual({ foo: "bar" });
  });

  it("defaults isReadOnly to false when not provided", () => {
    const tool = buildTool(baseDef);
    expect(tool.isReadOnly({})).toBe(false);
  });

  it("uses custom isReadOnly when provided", () => {
    const tool = buildTool({
      ...baseDef,
      isReadOnly: (input: Record<string, unknown>) => input.readOnly === true,
    });
    expect(tool.isReadOnly({ readOnly: true })).toBe(true);
    expect(tool.isReadOnly({ readOnly: false })).toBe(false);
  });

  it("defaults prompt to return the description when not provided", () => {
    const tool = buildTool(baseDef);
    expect(tool.prompt()).toBe("A test tool");
  });

  it("uses custom prompt when provided", () => {
    const tool = buildTool({
      ...baseDef,
      prompt: () => "Custom prompt text",
    });
    expect(tool.prompt()).toBe("Custom prompt text");
  });
});
