import { describe, expect, it } from "vitest";
import { deriveSubagentPermissions, getToolPermission, resolvePermission } from "./permissions";
import { getAgent } from "./agents";
import { SectionDraftTool } from "./tools/SectionDraftTool";

describe("agent permissions", () => {
  it("supports wildcard rules and specific overrides", () => {
    const rules = [
      { permission: "write", pattern: "*", action: "deny" as const },
      { permission: "write", pattern: "SectionDraft", action: "ask" as const },
    ];
    expect(resolvePermission(rules, "write", "Outline")).toBe("deny");
    expect(resolvePermission(rules, "write", "SectionDraft")).toBe("ask");
  });

  it("carries parent denies into subagents", () => {
    const rules = deriveSubagentPermissions(
      [{ permission: "write", pattern: "*", action: "deny" }],
      {
        name: "researcher",
        description: "research",
        mode: "subagent",
        prompt: "",
        permissions: [{ permission: "read", pattern: "*", action: "allow" }],
      }
    );
    expect(rules).toContainEqual({ permission: "write", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "read", pattern: "*", action: "allow" });
  });

  it("does not let subagents override an inherited denial", () => {
    const child = getAgent("writing")!;
    const permissions = deriveSubagentPermissions(
      [{ permission: "write", pattern: "*", action: "deny" }],
      child
    );
    expect(
      getToolPermission({ ...child, permissions }, SectionDraftTool, { action: "create" })
    ).toBe("deny");
  });

  it("does not let a tool-specific grant bypass an agent's write denial", () => {
    const reviewer = getAgent("reviewer")!;
    expect(
      getToolPermission(
        {
          ...reviewer,
          permissions: [
            ...reviewer.permissions,
            { permission: "tool", pattern: "SectionDraft", action: "allow" },
          ],
        },
        SectionDraftTool,
        { action: "create" }
      )
    ).toBe("deny");
  });

  it("honors an explicit tool approval requirement even when reads are allowed", () => {
    const reviewer = getAgent("reviewer")!;
    expect(
      getToolPermission(
        {
          ...reviewer,
          permissions: [
            ...reviewer.permissions,
            { permission: "tool", pattern: "SectionDraft", action: "ask" },
          ],
        },
        SectionDraftTool,
        { action: "list" }
      )
    ).toBe("ask");
  });
});
