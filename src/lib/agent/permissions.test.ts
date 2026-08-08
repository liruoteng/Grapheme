import { describe, expect, it } from "vitest";
import { deriveSubagentPermissions, resolvePermission } from "./permissions";

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
      },
    );
    expect(rules).toContainEqual({ permission: "write", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "read", pattern: "*", action: "allow" });
  });
});
