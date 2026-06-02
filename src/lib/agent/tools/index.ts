import type { Tool, Tools } from "../types";
import { LiteratureSearchTool } from "./LiteratureSearchTool";
import { CitationTool, clearCitationStore } from "./CitationTool";
import { SectionDraftTool, clearSectionStore } from "./SectionDraftTool";
import { OutlineTool, clearOutline } from "./OutlineTool";

const ALL_TOOLS: Tools = [
  LiteratureSearchTool,
  CitationTool,
  SectionDraftTool,
  OutlineTool,
] as const;

export function getAllTools(): Tools {
  return ALL_TOOLS;
}

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function getToolsForPhase(
  phase: "research" | "outlining" | "drafting" | "reviewing" | "polishing",
): Tools {
  switch (phase) {
    case "research":
      return [LiteratureSearchTool, CitationTool];
    case "outlining":
      return [OutlineTool, LiteratureSearchTool];
    case "drafting":
      return [SectionDraftTool, CitationTool, LiteratureSearchTool];
    case "reviewing":
      return [SectionDraftTool, CitationTool];
    case "polishing":
      return [SectionDraftTool];
  }
}

export function getToolPromptSummary(tools: Tools): string {
  return tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n");
}

export function clearAllToolState(): void {
  clearCitationStore();
  clearSectionStore();
  clearOutline();
}
