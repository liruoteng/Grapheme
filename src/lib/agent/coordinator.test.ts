import { describe, expect, it } from "vitest";
import {
  getCoordinatorSystemPrompt,
  getPhasePrompt,
  buildUserPrompt,
  getToolsForCurrentPhase,
} from "./coordinator";
import type { PaperState } from "./types";

function makePaper(overrides: Partial<PaperState> = {}): PaperState {
  return {
    id: "p1",
    title: "Test Paper",
    abstract: "",
    sections: [],
    citations: [],
    outline: [],
    phase: "drafting",
    citationStyle: "apa",
    revisionLog: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("getCoordinatorSystemPrompt", () => {
  it("includes the paper title", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper() });
    expect(prompt).toContain("Test Paper");
  });

  it("includes the current phase", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper({ phase: "research" }) });
    expect(prompt).toContain("research");
  });

  it("includes citation style", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper({ citationStyle: "ieee" }) });
    expect(prompt).toContain("ieee");
  });

  it("includes target journal when set", () => {
    const prompt = getCoordinatorSystemPrompt({
      paper: makePaper({ targetJournal: "Nature" }),
    });
    expect(prompt).toContain("Nature");
  });

  it("omits target journal line when not set", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper() });
    expect(prompt).not.toContain("**Target**");
  });

  it("includes section titles when present", () => {
    const paper = makePaper({
      sections: [
        { id: "s1", title: "Introduction", content: "", level: 1, status: "pending" },
        { id: "s2", title: "Methods", content: "", level: 1, status: "pending" },
      ],
    });
    const prompt = getCoordinatorSystemPrompt({ paper });
    expect(prompt).toContain("Introduction");
    expect(prompt).toContain("Methods");
  });

  it("includes citation count when citations exist", () => {
    const paper = makePaper({
      citations: [
        {
          id: "c1",
          bibKey: "smith2020",
          title: "A Paper",
          authors: ["Smith"],
          year: 2020,
          bibEntry: "@article{smith2020}",
        },
      ],
    });
    const prompt = getCoordinatorSystemPrompt({ paper });
    expect(prompt).toContain("1 references");
  });

  it("includes custom instructions when provided", () => {
    const prompt = getCoordinatorSystemPrompt({
      paper: makePaper(),
      customInstructions: "Be concise.",
    });
    expect(prompt).toContain("Be concise.");
  });

  it("omits custom instructions section when not provided", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper() });
    expect(prompt).not.toContain("Additional Instructions");
  });

  it("uses Untitled Paper when title is empty", () => {
    const prompt = getCoordinatorSystemPrompt({ paper: makePaper({ title: "" }) });
    expect(prompt).toContain("Untitled Paper");
  });
});

describe("getPhasePrompt", () => {
  it("returns guidance for each phase", () => {
    const phases = ["idle", "research", "outlining", "drafting", "reviewing", "polishing", "complete"] as const;
    for (const phase of phases) {
      const result = getPhasePrompt(phase);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("asks to help get started for idle phase", () => {
    expect(getPhasePrompt("idle")).toContain("get started");
  });

  it("mentions literature for research phase", () => {
    expect(getPhasePrompt("research")).toContain("literature");
  });

  it("mentions outline for outlining phase", () => {
    expect(getPhasePrompt("outlining")).toContain("outline");
  });
});

describe("buildUserPrompt", () => {
  it("returns the raw message when paper has no outline or citations", () => {
    const paper = makePaper();
    expect(buildUserPrompt("Write intro", paper)).toBe("Write intro");
  });

  it("includes outline context when outline exists", () => {
    const paper = makePaper({
      outline: [
        { id: "o1", title: "Introduction", level: 1, children: [] },
        { id: "o2", title: "Methods", level: 1, children: [] },
      ],
    });
    const result = buildUserPrompt("Write intro", paper);
    expect(result).toContain("Introduction");
    expect(result).toContain("Methods");
    expect(result).toContain("User request: Write intro");
  });

  it("includes citation context when citations exist", () => {
    const paper = makePaper({
      citations: [
        {
          id: "c1",
          bibKey: "smith2020",
          title: "A Paper",
          authors: ["Smith"],
          year: 2020,
          bibEntry: "@article{smith2020}",
        },
      ],
    });
    const result = buildUserPrompt("Cite something", paper);
    expect(result).toContain("@smith2020");
    expect(result).toContain("A Paper");
    expect(result).toContain("User request: Cite something");
  });

  it("flattens nested outline nodes", () => {
    const paper = makePaper({
      outline: [
        {
          id: "o1",
          title: "Intro",
          level: 1,
          children: [
            { id: "o1a", title: "Background", level: 2, children: [] },
          ],
        },
      ],
    });
    const result = buildUserPrompt("go", paper);
    expect(result).toContain("Intro");
    expect(result).toContain("Background");
  });
});

describe("getToolsForCurrentPhase", () => {
  it("returns drafting tools for idle phase", () => {
    const tools = getToolsForCurrentPhase("idle");
    expect(tools.map((t) => t.name)).toEqual(["SectionDraft", "Citation", "LiteratureSearch"]);
  });

  it("returns drafting tools for complete phase", () => {
    const tools = getToolsForCurrentPhase("complete");
    expect(tools.map((t) => t.name)).toEqual(["SectionDraft", "Citation", "LiteratureSearch"]);
  });

  it("returns research tools for research phase", () => {
    const tools = getToolsForCurrentPhase("research");
    expect(tools.map((t) => t.name)).toEqual(["LiteratureSearch", "Citation"]);
  });

  it("returns outlining tools for outlining phase", () => {
    const tools = getToolsForCurrentPhase("outlining");
    expect(tools.map((t) => t.name)).toEqual(["Outline", "LiteratureSearch"]);
  });

  it("returns polishing tools for polishing phase", () => {
    const tools = getToolsForCurrentPhase("polishing");
    expect(tools.map((t) => t.name)).toEqual(["SectionDraft"]);
  });
});
