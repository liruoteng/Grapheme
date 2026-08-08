import { invoke } from "@tauri-apps/api/core";

interface WorkspaceEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const SKIP_DIRECTORIES = new Set(["node_modules", "target", ".git", ".history", "dist"]);
const MAX_FILES = 250;
const MAX_DEPTH = 6;
const MAX_CONTEXT_CHARS = 45_000;
const MAX_FILE_CHARS = 18_000;

function relativePath(path: string, root: string): string {
  if (path === root) return ".";
  const slashPrefix = root.endsWith("/") ? root : `${root}/`;
  const backslashPrefix = root.endsWith("\\") ? root : `${root}\\`;
  if (path.startsWith(slashPrefix)) return path.slice(slashPrefix.length);
  if (path.startsWith(backslashPrefix)) return path.slice(backslashPrefix.length);
  return path;
}

function isTextCandidate(entry: WorkspaceEntry): boolean {
  const lower = entry.name.toLowerCase();
  return /\.(typ|md|markdown|bib|txt|tex|yaml|yml|json)$/i.test(lower)
    || /(feedback|review|comment|response|revision)/i.test(lower);
}

function priority(entry: WorkspaceEntry, activePath: string | null): number {
  const lower = entry.name.toLowerCase();
  if (activePath === entry.path) return 0;
  if (lower === "feedback.md" || /(feedback|review|comment)/i.test(lower)) return 1;
  if (/\.typ$/i.test(lower)) return 2;
  if (/\.(md|markdown|bib|tex)$/i.test(lower)) return 3;
  return 4;
}

async function collectFiles(
  dir: string,
  files: WorkspaceEntry[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

  let entries: WorkspaceEntry[];
  try {
    entries = await invoke<WorkspaceEntry[]>("list_dir", { path: dir });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    if (entry.is_dir) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        await collectFiles(entry.path, files, depth + 1);
      }
    } else if (isTextCandidate(entry)) {
      files.push(entry);
    }
  }
}

/**
 * Build bounded, explicit workspace context for the writing agent.
 * Files are read through the existing approved-path Tauri commands; the model
 * never receives arbitrary filesystem access merely because a folder is open.
 */
export async function loadWorkspaceAiContext(
  workspacePath: string | null,
  activePath: string | null,
  activeContent: string | null,
): Promise<string> {
  if (!workspacePath) return "";

  const files: WorkspaceEntry[] = [];
  await collectFiles(workspacePath, files, 0);
  files.sort((a, b) => priority(a, activePath) - priority(b, activePath));

  const inventory = files.length > 0
    ? files.map((file) => `- ${relativePath(file.path, workspacePath)}`).join("\n")
    : "(No supported text files were found.)";
  const sections: string[] = [];
  let remaining = MAX_CONTEXT_CHARS;

  for (const file of files) {
    if (remaining <= 0) break;
    let content: string;
    try {
      content = file.path === activePath && activeContent != null
        ? activeContent
        : await invoke<string>("read_file", { path: file.path });
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    const limit = Math.min(MAX_FILE_CHARS, remaining);
    const truncated = content.length > limit ? "\n[truncated]" : "";
    sections.push(`File: ${relativePath(file.path, workspacePath)}\n${content.slice(0, limit)}${truncated}`);
    remaining -= Math.min(content.length, limit);
  }

  return [
    `Workspace root: ${workspacePath}`,
    "Workspace text-file inventory:",
    inventory,
    sections.length > 0 ? `Relevant workspace file contents:\n\n${sections.join("\n\n---\n\n")}` : "",
    "Use the workspace paths above. If the user asks to edit a paper or address feedback, inspect the listed feedback/review file and the relevant .typ source before claiming the files are unavailable.",
  ].filter(Boolean).join("\n\n");
}
