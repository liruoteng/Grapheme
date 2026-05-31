import { buildTool } from "../buildTool";

type DraftAction = "create" | "update" | "get" | "list";

interface SectionDraftInput {
  action: DraftAction;
  sectionId?: string;
  title?: string;
  content?: string;
  level?: number;
  parentId?: string;
  instructions?: string;
}

interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
  parentId?: string;
  status: "pending" | "drafting" | "complete";
  updatedAt: number;
}

interface SectionResult {
  action: DraftAction;
  sections: Section[];
  message?: string;
}

const sectionStore = new Map<string, Section>();

function generateId(): string {
  return `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SectionDraftTool = buildTool<SectionDraftInput, SectionResult>({
  name: "SectionDraft",
  description:
    "Manage paper sections. Actions: 'create' a new section, 'update' existing content, 'get' a section by id, 'list' all sections.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "get", "list"],
        description: "The action to perform",
      },
      sectionId: {
        type: "string",
        description: "Section ID (required for update/get)",
      },
      title: { type: "string", description: "Section title (for create)" },
      content: {
        type: "string",
        description: "Section content in Typst or Markdown (for create/update)",
      },
      level: {
        type: "number",
        description: "Heading level 1-5 (for create, default: 1)",
      },
      parentId: {
        type: "string",
        description: "Parent section ID for nesting (for create)",
      },
      instructions: {
        type: "string",
        description: "Writing instructions when creating a draft section",
      },
    },
    required: ["action"],
  },
  isReadOnly: (input) => input.action === "get" || input.action === "list",
  async call(input) {
    switch (input.action) {
      case "create": {
        if (!input.title) {
          return {
            data: { action: "create", sections: [] },
            error: "title is required",
          };
        }
        const section: Section = {
          id: input.sectionId ?? generateId(),
          title: input.title,
          content: input.content ?? "",
          level: input.level ?? 1,
          parentId: input.parentId,
          status: input.content ? "drafting" : "pending",
          updatedAt: Date.now(),
        };
        sectionStore.set(section.id, section);
        return {
          data: {
            action: "create",
            sections: [section],
            message: `Created section: ${section.title}`,
          },
        };
      }

      case "update": {
        if (!input.sectionId) {
          return {
            data: { action: "update", sections: [] },
            error: "sectionId is required",
          };
        }
        const existing = sectionStore.get(input.sectionId);
        if (!existing) {
          return {
            data: { action: "update", sections: [] },
            error: `Section ${input.sectionId} not found`,
          };
        }
        const updated: Section = {
          ...existing,
          title: input.title ?? existing.title,
          content: input.content ?? existing.content,
          status: "drafting",
          updatedAt: Date.now(),
        };
        sectionStore.set(input.sectionId, updated);
        return {
          data: {
            action: "update",
            sections: [updated],
            message: `Updated section: ${updated.title}`,
          },
        };
      }

      case "get": {
        if (!input.sectionId) {
          return {
            data: { action: "get", sections: [] },
            error: "sectionId is required",
          };
        }
        const section = sectionStore.get(input.sectionId);
        if (!section) {
          return {
            data: { action: "get", sections: [] },
            error: `Section ${input.sectionId} not found`,
          };
        }
        return { data: { action: "get", sections: [section] } };
      }

      case "list": {
        const sections = Array.from(sectionStore.values()).sort(
          (a, b) => a.level - b.level || a.title.localeCompare(b.title),
        );
        return { data: { action: "list", sections } };
      }
    }
  },
  prompt() {
    return `Use SectionDraft to manage paper structure. Create sections with titles matching your outline. Update sections with drafted content in Typst or Markdown format. Use level 1 for main sections (Introduction, Methods), level 2 for subsections.`;
  },
});

export function clearSectionStore(): void {
  sectionStore.clear();
}

export function getSectionStore(): Map<string, Section> {
  return sectionStore;
}
