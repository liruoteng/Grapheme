import type { AgentInfo, PermissionAction, PermissionRule, Tool } from "./types";

export interface PermissionRequest {
  permission: string;
  pattern: string;
  agent: string;
  toolName?: string;
  input?: Record<string, unknown>;
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i").test(value);
}

/** Resolve the last matching rule, allowing specific rules to override defaults. */
export function resolvePermission(
  rules: readonly PermissionRule[],
  permission: string,
  value: string
): PermissionAction {
  let resolved: PermissionAction = "ask";
  for (const rule of rules) {
    if (rule.permission === permission && globMatches(rule.pattern, value)) {
      resolved = rule.action;
    }
  }
  return resolved;
}

export function getToolPermission<Input>(
  agent: AgentInfo,
  tool: Pick<Tool<Input>, "name" | "isReadOnly">,
  input: Input
): PermissionAction {
  const permission = tool.isReadOnly(input) ? "read" : "write";
  const specific = resolvePermission(agent.permissions, "tool", tool.name);
  const access = resolvePermission(agent.permissions, permission, tool.name);
  // A tool-specific grant must not lift an agent's read-only restriction.
  if (specific === "deny" || access === "deny") return "deny";
  if (
    agent.permissions.some(
      (rule) => rule.permission === "tool" && globMatches(rule.pattern, tool.name)
    )
  ) {
    return specific;
  }
  return access;
}

export function deriveSubagentPermissions(
  parent: readonly PermissionRule[],
  subagent: AgentInfo
): PermissionRule[] {
  return [
    ...subagent.permissions.filter(
      (rule) => rule.permission === "read" || rule.permission === "write"
    ),
    // Last matching rules win, so inherited restrictions must come last.
    ...parent.filter((rule) => rule.permission === "external_directory" || rule.action === "deny"),
  ];
}
