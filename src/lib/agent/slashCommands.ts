import type { AcademicWorkflowMode } from "./graphemeWritingPrompt";

export interface GraphemeSlashCommand {
  command: string;
  label: string;
  description: string;
  mode: AcademicWorkflowMode;
  prompt: string;
}

export const GRAPHEME_SLASH_COMMANDS: readonly GraphemeSlashCommand[] = [
  {
    command: "clarify",
    label: "Clarify question",
    description: "Scope a research question before drafting",
    mode: "clarify",
    prompt: "Help me scope this research topic: ",
  },
  {
    command: "research",
    label: "Research synthesis",
    description: "Analyze supplied sources and identify evidence gaps",
    mode: "research",
    prompt: "Synthesize the supplied sources and identify evidence gaps for: ",
  },
  {
    command: "outline",
    label: "Plan a paper",
    description: "Build an evidence-aware outline for approval",
    mode: "outline",
    prompt: "Create an outline and argument blueprint for: ",
  },
  {
    command: "draft",
    label: "Draft a section",
    description: "Write one section from approved evidence",
    mode: "draft",
    prompt: "Draft this section from the approved outline and supplied evidence: ",
  },
  {
    command: "review",
    label: "Review draft",
    description: "Run a read-only academic review",
    mode: "review",
    prompt: "Review this manuscript and produce a revision roadmap.",
  },
  {
    command: "revise",
    label: "Revise selection",
    description: "Improve clarity without adding unsupported claims",
    mode: "revise",
    prompt: "Improve the selected text for clarity, flow, and academic tone.",
  },
  {
    command: "citations",
    label: "Audit citations",
    description: "Check citation integrity without editing",
    mode: "citation-audit",
    prompt: "Audit the manuscript citations and report blocking issues.",
  },
  {
    command: "cite",
    label: "Find sources",
    description: "Search papers and prepare BibTeX-ready citations",
    mode: "research",
    prompt: "/cite ",
  },
];

export function getSlashCommandQuery(input: string): string | null {
  const match = input.match(/^\/([^\s]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function filterSlashCommands(input: string): readonly GraphemeSlashCommand[] {
  const query = getSlashCommandQuery(input);
  if (query === null) return [];
  return GRAPHEME_SLASH_COMMANDS.filter((command) =>
    `${command.command} ${command.label} ${command.description}`
      .toLowerCase()
      .includes(query),
  );
}
