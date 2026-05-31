import type { PaperState, PaperPhase, Tools } from "./types";
import { getToolsForPhase, getToolPromptSummary } from "./tools";

type WorkflowPhase = "research" | "outlining" | "drafting" | "reviewing" | "polishing";

function toWorkflowPhase(phase: PaperPhase): WorkflowPhase {
  if (phase === "idle" || phase === "complete") return "drafting";
  return phase;
}

export interface CoordinatorConfig {
  paper: PaperState;
  customInstructions?: string;
}

export function getCoordinatorSystemPrompt(config: CoordinatorConfig): string {
  const { paper, customInstructions } = config;

  return `You are the Grapheme Paper Coordinator, an AI assistant that orchestrates academic paper writing.

## Your Role

You coordinate the writing workflow for the paper: "${paper.title || "Untitled Paper"}"

Your job is to:
- Guide the user through the paper writing process
- Use tools to research, outline, draft, and refine the paper
- Maintain academic rigor and proper citation
- Adapt to the user's target journal/conference requirements

## Current Paper State

**Phase**: ${paper.phase}
**Title**: ${paper.title || "(not set)"}
**Citation Style**: ${paper.citationStyle}
${paper.targetJournal ? `**Target**: ${paper.targetJournal}` : ""}
${paper.sections.length > 0 ? `**Sections**: ${paper.sections.map((s) => s.title).join(", ")}` : ""}
${paper.citations.length > 0 ? `**Citations**: ${paper.citations.length} references` : ""}

## Available Tools

${getToolPromptSummary(getToolsForPhase(toWorkflowPhase(paper.phase)))}

## Workflow Phases

| Phase | Purpose | Key Actions |
|-------|---------|-------------|
| Research | Gather literature | LiteratureSearch, Citation (add) |
| Outlining | Structure the paper | Outline (set/add) |
| Drafting | Write sections | SectionDraft (create/update), Citation |
| Reviewing | Check quality | SectionDraft (get), Citation (list) |
| Polishing | Final refinements | SectionDraft (update) |

## Guidelines

1. **Research first**: Before writing, search for relevant literature and add citations
2. **Outline before drafting**: Create a clear structure with the Outline tool
3. **Cite as you write**: Reference citations using @bibKey in section content
4. **Be specific**: When creating sections, include concrete content, not placeholders
5. **Academic tone**: Write in formal academic language appropriate for the field

${customInstructions ? `\n## Additional Instructions\n\n${customInstructions}` : ""}
`;
}

export function getPhasePrompt(phase: PaperPhase): string {
  switch (phase) {
    case "idle":
      return "Help the user get started. Ask about their research topic and goals.";
    case "research":
      return "Search for relevant literature. Find key papers, theories, and methods related to the topic. Add important citations.";
    case "outlining":
      return "Create a structured outline for the paper. Include main sections and subsections following academic conventions.";
    case "drafting":
      return "Draft each section based on the outline. Include citations where appropriate. Write in academic prose.";
    case "reviewing":
      return "Review the drafted sections for clarity, coherence, and completeness. Check that all claims are supported by citations.";
    case "polishing":
      return "Refine the language, check formatting, and ensure consistency across sections.";
    case "complete":
      return "The paper is complete. Help with any final adjustments or export.";
  }
}

export function buildUserPrompt(
  userMessage: string,
  paper: PaperState,
): string {
  const contextParts: string[] = [];

  if (paper.outline.length > 0) {
    const outlineText = flattenOutline(paper.outline);
    contextParts.push(`Current outline:\n${outlineText}`);
  }

  if (paper.citations.length > 0) {
    const citationList = paper.citations
      .map((c) => `@${c.bibKey}: ${c.title} (${c.year})`)
      .join("\n");
    contextParts.push(`Available citations:\n${citationList}`);
  }

  if (contextParts.length === 0) {
    return userMessage;
  }

  return `${contextParts.join("\n\n")}\n\n---\n\nUser request: ${userMessage}`;
}

function flattenOutline(
  nodes: PaperState["outline"],
  indent = 0,
): string {
  return nodes
    .map((node) => {
      const prefix = "  ".repeat(indent);
      const line = `${prefix}- ${node.title}`;
      if (node.children.length > 0) {
        return `${line}\n${flattenOutline(node.children, indent + 1)}`;
      }
      return line;
    })
    .join("\n");
}

export function getToolsForCurrentPhase(phase: PaperPhase): Tools {
  if (phase === "idle" || phase === "complete") {
    return getToolsForPhase("drafting");
  }
  return getToolsForPhase(phase);
}
