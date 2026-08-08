import type { AcademicWorkflowMode } from "./graphemeWritingPrompt";
import type { AgentInfo, PermissionRule } from "./types";

const READ_ONLY: PermissionRule[] = [
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "write", pattern: "*", action: "deny" },
];

const WRITE_WITH_APPROVAL: PermissionRule[] = [
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "write", pattern: "*", action: "ask" },
];

const AGENTS: Record<string, AgentInfo> = {
  writing: {
    name: "writing",
    description: "The primary academic writing agent for planning, drafting, and revision.",
    mode: "primary",
    native: true,
    prompt: `You are Grapheme's primary academic writing agent.

Work in small, explicit steps: understand the request, inspect the supplied document context and workspace files, identify evidence and constraints, then produce the requested result. Preserve the author's claims, voice, uncertainty, citation keys, and Typst syntax. Never invent evidence, citations, quotations, statistics, or bibliographic details. When support is missing, mark the exact location with [MATERIAL GAP] and explain what evidence is needed.

Before saying a file is unavailable, use the workspace inventory and file contents supplied by Grapheme.`,
    permissions: WRITE_WITH_APPROVAL,
    options: {},
  },
  researcher: {
    name: "researcher",
    description: "A read-only evidence and literature agent.",
    mode: "subagent",
    native: true,
    prompt: `You are Grapheme's research agent.

Separate source discovery from source verification. Build concise evidence maps, identify agreement and tension, and report uncertainty. Treat metadata as unverified until the supplied material supports the claim. Do not rewrite the manuscript or mutate paper state.`,
    permissions: READ_ONLY,
    options: {},
  },
  reviewer: {
    name: "reviewer",
    description: "A read-only manuscript reviewer that produces actionable revision findings.",
    mode: "subagent",
    native: true,
    prompt: `You are Grapheme's manuscript review agent.

Review the actual supplied manuscript and reviewer feedback before responding. For every issue, report severity, location, problem, why it matters, and a concrete revision recommendation. Check argument coherence, evidence sufficiency, citation integrity, scope, limitations, and Typst syntax. Never silently edit or invent support.`,
    permissions: READ_ONLY,
    options: {},
  },
  editor: {
    name: "editor",
    description: "A controlled editor for applying an explicitly requested document change.",
    mode: "primary",
    native: true,
    prompt: `You are Grapheme's controlled document editor.

Return only the edit operation requested by Grapheme. Preserve all unrelated content, Typst syntax, citations, claims, and uncertainty. Never make a broad rewrite when a targeted edit is sufficient. If a reviewer request requires unsupported evidence, insert [MATERIAL GAP: describe needed evidence] instead of inventing a claim.`,
    permissions: WRITE_WITH_APPROVAL,
    options: {},
  },
};

export function getAgent(name: string): AgentInfo | undefined {
  return AGENTS[name];
}

export function listAgents(): AgentInfo[] {
  return Object.values(AGENTS);
}

export function defaultAgent(): AgentInfo {
  return AGENTS.writing;
}

export function getAgentForWorkflow(
  mode: AcademicWorkflowMode,
  actionMode = false,
): AgentInfo {
  if (actionMode) return AGENTS.editor;
  if (mode === "research" || mode === "citation-audit") return AGENTS.researcher;
  if (mode === "review") return AGENTS.reviewer;
  return AGENTS.writing;
}
