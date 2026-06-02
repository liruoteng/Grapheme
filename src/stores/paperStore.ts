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

type PapersRecord = Record<string, PaperState>;

interface PaperStore {
  papers: PapersRecord;
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
  papers: {},
  activePaperId: null,

  createPaper: (title) => {
    const paper = createEmptyPaper();
    if (title) paper.title = title;
    set((state) => ({
      papers: { ...state.papers, [paper.id]: paper },
      activePaperId: paper.id,
    }));
    return paper.id;
  },

  setActivePaper: (id) => set({ activePaperId: id }),

  deletePaper: (id) =>
    set((state) => {
      const papers = Object.fromEntries(
        Object.entries(state.papers).filter(([key]) => key !== id)
      );
      return {
        papers,
        activePaperId: state.activePaperId === id ? null : state.activePaperId,
      };
    }),

  getActivePaper: () => {
    const { papers, activePaperId } = get();
    if (!activePaperId) return null;
    return papers[activePaperId] ?? null;
  },

  updatePaperMeta: (id, updates) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: { ...paper, ...updates, updatedAt: Date.now() },
        },
      };
    }),

  setPhase: (id, phase) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: { ...paper, phase, updatedAt: Date.now() },
        },
      };
    }),

  addSection: (id, section) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      const newSection: PaperSection = {
        ...section,
        id: generateId(),
        status: "pending",
      };
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            sections: [...paper.sections, newSection],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  updateSection: (id, sectionId, updates) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            sections: paper.sections.map((s) =>
              s.id === sectionId ? { ...s, ...updates, status: "drafting" } : s,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeSection: (id, sectionId) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            sections: paper.sections.filter((s) => s.id !== sectionId),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  addCitation: (id, citation) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      const newCitation: Citation = { ...citation, id: generateId() };
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            citations: [...paper.citations, newCitation],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeCitation: (id, citationId) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            citations: paper.citations.filter((c) => c.id !== citationId),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setOutline: (id, outline) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: { ...paper, outline, updatedAt: Date.now() },
        },
      };
    }),

  addOutlineNode: (id, node, parentId) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            outline: parentId
              ? addChildToOutline(paper.outline, parentId, node)
              : [...paper.outline, node],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeOutlineNode: (id, nodeId) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            outline: removeFromOutline(paper.outline, nodeId),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  addRevision: (id, revision) =>
    set((state) => {
      const paper = state.papers[id];
      if (!paper) return state;
      const entry: RevisionEntry = {
        ...revision,
        id: generateId(),
        timestamp: Date.now(),
      };
      return {
        papers: {
          ...state.papers,
          [id]: {
            ...paper,
            revisionLog: [...paper.revisionLog, entry],
            updatedAt: Date.now(),
          },
        },
      };
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
