import { create } from "zustand";
import type {
  PaperState,
  PaperPhase,
  PaperSection,
  Citation,
  OutlineNode,
  RevisionEntry,
} from "../lib/agent/types";

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyPaper(): PaperState {
  return {
    id: generateId(),
    title: "",
    abstract: "",
    sections: [],
    citations: [],
    outline: [],
    phase: "idle",
    citationStyle: "apa",
    revisionLog: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface PaperStore {
  papers: Map<string, PaperState>;
  activePaperId: string | null;

  createPaper: (title?: string) => string;
  setActivePaper: (id: string | null) => void;
  deletePaper: (id: string) => void;
  getActivePaper: () => PaperState | null;

  updatePaperMeta: (id: string, updates: {
    title?: string;
    abstract?: string;
    targetJournal?: string;
    citationStyle?: string;
  }) => void;

  setPhase: (id: string, phase: PaperPhase) => void;

  addSection: (id: string, section: Omit<PaperSection, "id" | "status" | "updatedAt">) => void;
  updateSection: (id: string, sectionId: string, updates: { title?: string; content?: string }) => void;
  removeSection: (id: string, sectionId: string) => void;

  addCitation: (id: string, citation: Omit<Citation, "id">) => void;
  removeCitation: (id: string, citationId: string) => void;

  setOutline: (id: string, outline: OutlineNode[]) => void;
  addOutlineNode: (id: string, node: OutlineNode, parentId?: string) => void;
  removeOutlineNode: (id: string, nodeId: string) => void;

  addRevision: (id: string, revision: Omit<RevisionEntry, "id" | "timestamp">) => void;
}

export const usePaperStore = create<PaperStore>((set, get) => ({
  papers: new Map(),
  activePaperId: null,

  createPaper: (title) => {
    const paper = createEmptyPaper();
    if (title) paper.title = title;
    set((state) => {
      const papers = new Map(state.papers);
      papers.set(paper.id, paper);
      return { papers, activePaperId: paper.id };
    });
    return paper.id;
  },

  setActivePaper: (id) => set({ activePaperId: id }),

  deletePaper: (id) =>
    set((state) => {
      const papers = new Map(state.papers);
      papers.delete(id);
      return {
        papers,
        activePaperId: state.activePaperId === id ? null : state.activePaperId,
      };
    }),

  getActivePaper: () => {
    const { papers, activePaperId } = get();
    if (!activePaperId) return null;
    return papers.get(activePaperId) ?? null;
  },

  updatePaperMeta: (id, updates) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, { ...paper, ...updates, updatedAt: Date.now() });
      return { papers };
    }),

  setPhase: (id, phase) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, { ...paper, phase, updatedAt: Date.now() });
      return { papers };
    }),

  addSection: (id, section) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const newSection: PaperSection = {
        ...section,
        id: generateId(),
        status: "pending",
      };
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        sections: [...paper.sections, newSection],
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  updateSection: (id, sectionId, updates) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        sections: paper.sections.map((s) =>
          s.id === sectionId ? { ...s, ...updates, status: "drafting" } : s,
        ),
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  removeSection: (id, sectionId) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        sections: paper.sections.filter((s) => s.id !== sectionId),
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  addCitation: (id, citation) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const newCitation: Citation = { ...citation, id: generateId() };
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        citations: [...paper.citations, newCitation],
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  removeCitation: (id, citationId) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        citations: paper.citations.filter((c) => c.id !== citationId),
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  setOutline: (id, outline) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, { ...paper, outline, updatedAt: Date.now() });
      return { papers };
    }),

  addOutlineNode: (id, node, parentId) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      if (parentId) {
        papers.set(id, {
          ...paper,
          outline: addChildToOutline(paper.outline, parentId, node),
          updatedAt: Date.now(),
        });
      } else {
        papers.set(id, {
          ...paper,
          outline: [...paper.outline, node],
          updatedAt: Date.now(),
        });
      }
      return { papers };
    }),

  removeOutlineNode: (id, nodeId) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        outline: removeFromOutline(paper.outline, nodeId),
        updatedAt: Date.now(),
      });
      return { papers };
    }),

  addRevision: (id, revision) =>
    set((state) => {
      const paper = state.papers.get(id);
      if (!paper) return state;
      const entry: RevisionEntry = {
        ...revision,
        id: generateId(),
        timestamp: Date.now(),
      };
      const papers = new Map(state.papers);
      papers.set(id, {
        ...paper,
        revisionLog: [...paper.revisionLog, entry],
        updatedAt: Date.now(),
      });
      return { papers };
    }),
}));

function addChildToOutline(
  nodes: OutlineNode[],
  parentId: string,
  child: OutlineNode,
): OutlineNode[] {
  return nodes.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] };
    }
    return { ...n, children: addChildToOutline(n.children, parentId, child) };
  });
}

function removeFromOutline(nodes: OutlineNode[], nodeId: string): OutlineNode[] {
  return nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => ({ ...n, children: removeFromOutline(n.children, nodeId) }));
}
