import { describe, it, expect, beforeEach } from "vitest";
import { usePaperStore } from "./paperStore";

beforeEach(() => {
  usePaperStore.setState({ papers: {}, activePaperId: null });
});

describe("initial state", () => {
  it("has empty papers and null activePaperId", () => {
    const s = usePaperStore.getState();
    expect(s.papers).toEqual({});
    expect(s.activePaperId).toBeNull();
  });
});

describe("createPaper", () => {
  it("creates a paper with default values and sets it active", () => {
    const id = usePaperStore.getState().createPaper();
    const s = usePaperStore.getState();
    expect(s.papers[id]).toBeDefined();
    expect(s.papers[id].title).toBe("");
    expect(s.papers[id].abstract).toBe("");
    expect(s.papers[id].sections).toEqual([]);
    expect(s.papers[id].citations).toEqual([]);
    expect(s.papers[id].outline).toEqual([]);
    expect(s.papers[id].phase).toBe("idle");
    expect(s.papers[id].citationStyle).toBe("apa");
    expect(s.papers[id].revisionLog).toEqual([]);
    expect(s.activePaperId).toBe(id);
  });

  it("creates a paper with a title", () => {
    const id = usePaperStore.getState().createPaper("My Paper");
    expect(usePaperStore.getState().papers[id].title).toBe("My Paper");
  });

  it("returns unique ids for multiple papers", () => {
    const id1 = usePaperStore.getState().createPaper("A");
    const id2 = usePaperStore.getState().createPaper("B");
    expect(id1).not.toBe(id2);
    expect(Object.keys(usePaperStore.getState().papers)).toHaveLength(2);
  });

  it("sets the newest paper as active", () => {
    usePaperStore.getState().createPaper("A");
    const id2 = usePaperStore.getState().createPaper("B");
    expect(usePaperStore.getState().activePaperId).toBe(id2);
  });
});

describe("setActivePaper", () => {
  it("sets the active paper id", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().setActivePaper(id);
    expect(usePaperStore.getState().activePaperId).toBe(id);
  });

  it("can set active paper to null", () => {
    usePaperStore.getState().createPaper();
    usePaperStore.getState().setActivePaper(null);
    expect(usePaperStore.getState().activePaperId).toBeNull();
  });
});

describe("deletePaper", () => {
  it("removes the paper from papers", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().deletePaper(id);
    expect(usePaperStore.getState().papers[id]).toBeUndefined();
  });

  it("clears activePaperId when active paper is deleted", () => {
    const id = usePaperStore.getState().createPaper();
    expect(usePaperStore.getState().activePaperId).toBe(id);
    usePaperStore.getState().deletePaper(id);
    expect(usePaperStore.getState().activePaperId).toBeNull();
  });

  it("preserves activePaperId when a different paper is deleted", () => {
    const id1 = usePaperStore.getState().createPaper("A");
    usePaperStore.getState().createPaper("B");
    usePaperStore.getState().setActivePaper(id1);
    usePaperStore.getState().deletePaper(usePaperStore.getState().activePaperId === id1 ? "other" : id1);
    usePaperStore.getState().setActivePaper(id1);
    const id2 = Object.keys(usePaperStore.getState().papers).find((k) => k !== id1)!;
    usePaperStore.getState().deletePaper(id2);
    expect(usePaperStore.getState().activePaperId).toBe(id1);
  });
});

describe("getActivePaper", () => {
  it("returns null when no active paper", () => {
    expect(usePaperStore.getState().getActivePaper()).toBeNull();
  });

  it("returns the active paper", () => {
    const id = usePaperStore.getState().createPaper("Test");
    const paper = usePaperStore.getState().getActivePaper();
    expect(paper).not.toBeNull();
    expect(paper!.id).toBe(id);
    expect(paper!.title).toBe("Test");
  });

  it("returns null if activePaperId references a non-existent paper", () => {
    usePaperStore.setState({ activePaperId: "nonexistent" });
    expect(usePaperStore.getState().getActivePaper()).toBeNull();
  });
});

describe("updatePaperMeta", () => {
  it("updates title and abstract", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().updatePaperMeta(id, { title: "New Title", abstract: "New Abstract" });
    const paper = usePaperStore.getState().papers[id];
    expect(paper.title).toBe("New Title");
    expect(paper.abstract).toBe("New Abstract");
  });

  it("updates targetJournal and citationStyle", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().updatePaperMeta(id, { targetJournal: "Nature", citationStyle: "ieee" });
    const paper = usePaperStore.getState().papers[id];
    expect(paper.targetJournal).toBe("Nature");
    expect(paper.citationStyle).toBe("ieee");
  });

  it("updates updatedAt timestamp", () => {
    const id = usePaperStore.getState().createPaper();
    const before = usePaperStore.getState().papers[id].updatedAt;
    usePaperStore.getState().updatePaperMeta(id, { title: "Changed" });
    expect(usePaperStore.getState().papers[id].updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op for non-existent paper", () => {
    const before = usePaperStore.getState().papers;
    usePaperStore.getState().updatePaperMeta("nonexistent", { title: "X" });
    expect(usePaperStore.getState().papers).toEqual(before);
  });
});

describe("setPhase", () => {
  it("updates the paper phase", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().setPhase(id, "research");
    expect(usePaperStore.getState().papers[id].phase).toBe("research");
  });

  it("cycles through all phases", () => {
    const id = usePaperStore.getState().createPaper();
    const phases = ["research", "outlining", "drafting", "reviewing", "polishing", "complete"] as const;
    for (const phase of phases) {
      usePaperStore.getState().setPhase(id, phase);
      expect(usePaperStore.getState().papers[id].phase).toBe(phase);
    }
  });

  it("is a no-op for non-existent paper", () => {
    const before = usePaperStore.getState().papers;
    usePaperStore.getState().setPhase("nonexistent", "research");
    expect(usePaperStore.getState().papers).toEqual(before);
  });
});

describe("addSection", () => {
  it("adds a section with generated id and pending status", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addSection(id, { title: "Intro", content: "Hello", level: 1 });
    const sections = usePaperStore.getState().papers[id].sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Intro");
    expect(sections[0].content).toBe("Hello");
    expect(sections[0].level).toBe(1);
    expect(sections[0].status).toBe("pending");
    expect(sections[0].id).toBeDefined();
  });

  it("appends multiple sections", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addSection(id, { title: "A", content: "", level: 1 });
    usePaperStore.getState().addSection(id, { title: "B", content: "", level: 2 });
    const sections = usePaperStore.getState().papers[id].sections;
    expect(sections).toHaveLength(2);
    expect(sections[1].title).toBe("B");
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().addSection("nonexistent", { title: "X", content: "", level: 1 });
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("updateSection", () => {
  it("updates section title and content, sets status to drafting", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addSection(id, { title: "Intro", content: "Old", level: 1 });
    const sectionId = usePaperStore.getState().papers[id].sections[0].id;
    usePaperStore.getState().updateSection(id, sectionId, { title: "Introduction", content: "New" });
    const section = usePaperStore.getState().papers[id].sections[0];
    expect(section.title).toBe("Introduction");
    expect(section.content).toBe("New");
    expect(section.status).toBe("drafting");
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().updateSection("nonexistent", "sec1", { title: "X" });
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("removeSection", () => {
  it("removes the section by id", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addSection(id, { title: "A", content: "", level: 1 });
    usePaperStore.getState().addSection(id, { title: "B", content: "", level: 1 });
    const sectionId = usePaperStore.getState().papers[id].sections[0].id;
    usePaperStore.getState().removeSection(id, sectionId);
    const sections = usePaperStore.getState().papers[id].sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("B");
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().removeSection("nonexistent", "sec1");
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("addCitation", () => {
  it("adds a citation with generated id", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addCitation(id, {
      bibKey: "smith2024",
      title: "A Study",
      authors: ["Smith"],
      year: 2024,
      bibEntry: "@article{smith2024}",
    });
    const citations = usePaperStore.getState().papers[id].citations;
    expect(citations).toHaveLength(1);
    expect(citations[0].bibKey).toBe("smith2024");
    expect(citations[0].title).toBe("A Study");
    expect(citations[0].id).toBeDefined();
  });

  it("appends multiple citations", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addCitation(id, { bibKey: "a", title: "A", authors: [], year: 2020, bibEntry: "" });
    usePaperStore.getState().addCitation(id, { bibKey: "b", title: "B", authors: [], year: 2021, bibEntry: "" });
    expect(usePaperStore.getState().papers[id].citations).toHaveLength(2);
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().addCitation("nonexistent", { bibKey: "x", title: "X", authors: [], year: 2020, bibEntry: "" });
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("removeCitation", () => {
  it("removes the citation by id", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addCitation(id, { bibKey: "a", title: "A", authors: [], year: 2020, bibEntry: "" });
    usePaperStore.getState().addCitation(id, { bibKey: "b", title: "B", authors: [], year: 2021, bibEntry: "" });
    const citationId = usePaperStore.getState().papers[id].citations[0].id;
    usePaperStore.getState().removeCitation(id, citationId);
    const citations = usePaperStore.getState().papers[id].citations;
    expect(citations).toHaveLength(1);
    expect(citations[0].bibKey).toBe("b");
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().removeCitation("nonexistent", "cit1");
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("setOutline", () => {
  it("replaces the outline", () => {
    const id = usePaperStore.getState().createPaper();
    const outline = [{ id: "n1", title: "Intro", level: 1, children: [] }];
    usePaperStore.getState().setOutline(id, outline);
    expect(usePaperStore.getState().papers[id].outline).toEqual(outline);
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().setOutline("nonexistent", []);
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("addOutlineNode", () => {
  it("adds a root-level node", () => {
    const id = usePaperStore.getState().createPaper();
    const node = { id: "n1", title: "Intro", level: 1, children: [] };
    usePaperStore.getState().addOutlineNode(id, node);
    expect(usePaperStore.getState().papers[id].outline).toEqual([node]);
  });

  it("adds a child node under a parent", () => {
    const id = usePaperStore.getState().createPaper();
    const parent = { id: "n1", title: "Intro", level: 1, children: [] };
    usePaperStore.getState().addOutlineNode(id, parent);
    const child = { id: "n2", title: "Background", level: 2, children: [] };
    usePaperStore.getState().addOutlineNode(id, child, "n1");
    const outline = usePaperStore.getState().papers[id].outline;
    expect(outline).toHaveLength(1);
    expect(outline[0].children).toHaveLength(1);
    expect(outline[0].children[0].id).toBe("n2");
  });

  it("adds a deeply nested child", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addOutlineNode(id, { id: "n1", title: "A", level: 1, children: [] });
    usePaperStore.getState().addOutlineNode(id, { id: "n2", title: "B", level: 2, children: [] }, "n1");
    usePaperStore.getState().addOutlineNode(id, { id: "n3", title: "C", level: 3, children: [] }, "n2");
    const outline = usePaperStore.getState().papers[id].outline;
    expect(outline[0].children[0].children[0].id).toBe("n3");
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().addOutlineNode("nonexistent", { id: "n1", title: "X", level: 1, children: [] });
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("removeOutlineNode", () => {
  it("removes a root-level node", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addOutlineNode(id, { id: "n1", title: "A", level: 1, children: [] });
    usePaperStore.getState().addOutlineNode(id, { id: "n2", title: "B", level: 1, children: [] });
    usePaperStore.getState().removeOutlineNode(id, "n1");
    const outline = usePaperStore.getState().papers[id].outline;
    expect(outline).toHaveLength(1);
    expect(outline[0].id).toBe("n2");
  });

  it("removes a nested node", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addOutlineNode(id, { id: "n1", title: "A", level: 1, children: [] });
    usePaperStore.getState().addOutlineNode(id, { id: "n2", title: "B", level: 2, children: [] }, "n1");
    usePaperStore.getState().removeOutlineNode(id, "n2");
    expect(usePaperStore.getState().papers[id].outline[0].children).toHaveLength(0);
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().removeOutlineNode("nonexistent", "n1");
    expect(usePaperStore.getState().papers).toEqual({});
  });
});

describe("addRevision", () => {
  it("adds a revision entry with generated id and timestamp", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addRevision(id, {
      sectionId: "sec1",
      description: "Rewrote intro",
      before: "old",
      after: "new",
    });
    const log = usePaperStore.getState().papers[id].revisionLog;
    expect(log).toHaveLength(1);
    expect(log[0].sectionId).toBe("sec1");
    expect(log[0].description).toBe("Rewrote intro");
    expect(log[0].before).toBe("old");
    expect(log[0].after).toBe("new");
    expect(log[0].id).toBeDefined();
    expect(typeof log[0].timestamp).toBe("number");
  });

  it("appends multiple revisions", () => {
    const id = usePaperStore.getState().createPaper();
    usePaperStore.getState().addRevision(id, { sectionId: "s1", description: "A", before: "", after: "a" });
    usePaperStore.getState().addRevision(id, { sectionId: "s2", description: "B", before: "", after: "b" });
    expect(usePaperStore.getState().papers[id].revisionLog).toHaveLength(2);
  });

  it("is a no-op for non-existent paper", () => {
    usePaperStore.getState().addRevision("nonexistent", { sectionId: "s", description: "x", before: "", after: "" });
    expect(usePaperStore.getState().papers).toEqual({});
  });
});
