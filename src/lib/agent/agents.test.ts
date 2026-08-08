import { describe, expect, it } from "vitest";
import { defaultAgent, getAgent, getAgentForWorkflow, listAgents } from "./agents";

describe("Grapheme agent registry", () => {
  it("provides the common primary and subagent roles", () => {
    expect(listAgents().map((agent) => agent.name)).toEqual([
      "writing",
      "researcher",
      "reviewer",
      "editor",
    ]);
    expect(defaultAgent().name).toBe("writing");
    expect(getAgent("reviewer")?.mode).toBe("subagent");
  });

  it("maps workflow modes to focused agents", () => {
    expect(getAgentForWorkflow("research").name).toBe("researcher");
    expect(getAgentForWorkflow("review").name).toBe("reviewer");
    expect(getAgentForWorkflow("draft").name).toBe("writing");
    expect(getAgentForWorkflow("draft", true).name).toBe("editor");
  });
});
