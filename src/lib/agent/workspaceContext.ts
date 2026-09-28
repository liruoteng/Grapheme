import { invoke } from "@tauri-apps/api/core";

interface WorkspaceEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const SKIP_DIRECTORIES = new Set(["node_modules", "target", ".git", ".history", "dist"]);
const MAX_FILES = 250;
const MAX_DEPTH = 6;
const MAX_DIRECTORY_READS = 100;
const MAX_ENTRIES = 5_000;
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
  return (
    /\.(typ|md|markdown|bib|txt|tex|yaml|yml|json)$/i.test(lower) ||
    /(feedback|review|comment|response|revision)/i.test(lower)
  );
}

function isPrivateEntry(entry: WorkspaceEntry): boolean {
  return (
    entry.name.startsWith(".") ||
    /^(?:credentials?|secrets?|tokens?|service[-_]account)(?:[._-]|$)/i.test(entry.name)
  );
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
  budget: { directories: number; entries: number; visited: Set<string> },
  signal?: AbortSignal
): Promise<boolean> {
  const pending = [{ path: dir, depth: 0 }];
  let rootListed = false;
  for (let index = 0; index < pending.length; index++) {
    signal?.throwIfAborted();
    if (files.length >= MAX_FILES || budget.directories <= 0 || budget.entries <= 0) break;
    const next = pending[index];
    if (budget.visited.has(next.path)) continue;
    budget.visited.add(next.path);
    budget.directories--;
    let entries: WorkspaceEntry[];
    try {
      entries = await invoke<WorkspaceEntry[]>("list_dir", { path: next.path });
      if (next.path === dir) rootListed = true;
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    signal?.throwIfAborted();
    for (const entry of entries) {
      if (files.length >= MAX_FILES || budget.entries <= 0) break;
      budget.entries--;
      if (isPrivateEntry(entry)) continue;
      if (entry.is_dir) {
        if (next.depth < MAX_DEPTH && !SKIP_DIRECTORIES.has(entry.name)) {
          pending.push({ path: entry.path, depth: next.depth + 1 });
        }
      } else if (isTextCandidate(entry)) {
        files.push(entry);
      }
    }
  }
  return rootListed;
}

function fileEntry(path: string): WorkspaceEntry {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    is_dir: false,
  };
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
  approvedPaths: readonly string[] = [],
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  if (!workspacePath && approvedPaths.length === 0 && !activePath) return "";

  const files: WorkspaceEntry[] = [];
  const budget = {
    directories: MAX_DIRECTORY_READS,
    entries: MAX_ENTRIES,
    visited: new Set<string>(),
  };
  // Explicitly selected files take priority over automatic discovery. This also
  // keeps the active manuscript available when the workspace hits its budget.
  if (activePath && isTextCandidate(fileEntry(activePath))) files.push(fileEntry(activePath));
  if (workspacePath) await collectFiles(workspacePath, files, budget, signal);
  for (const approvedPath of approvedPaths) {
    signal?.throwIfAborted();
    const listed = await collectFiles(approvedPath, files, budget, signal);
    // list_dir fails for an approved file; include that exact file instead.
    if (!listed && isTextCandidate(fileEntry(approvedPath))) {
      files.push(fileEntry(approvedPath));
    }
  }
  const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
  uniqueFiles.sort((a, b) => priority(a, activePath) - priority(b, activePath));

  const inventory =
    uniqueFiles.length > 0
      ? uniqueFiles
          .map((file) => `- ${workspacePath ? relativePath(file.path, workspacePath) : file.path}`)
          .join("\n")
      : "(No supported text files were found.)";
  const sections: string[] = [];
  let remaining = MAX_CONTEXT_CHARS;

  for (const file of uniqueFiles) {
    signal?.throwIfAborted();
    if (remaining <= 0) break;
    let content: string;
    try {
      content =
        file.path === activePath && activeContent != null
          ? activeContent
          : await invoke<string>("read_file", { path: file.path, maxBytes: MAX_FILE_CHARS * 4 });
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    signal?.throwIfAborted();
    if (!content.trim()) continue;
    const limit = Math.min(MAX_FILE_CHARS, remaining);
    const truncated = content.length > limit ? "\n[truncated]" : "";
    const label =
      workspacePath && file.path.startsWith(workspacePath)
        ? relativePath(file.path, workspacePath)
        : file.path;
    sections.push(`File: ${label}\n${content.slice(0, limit)}${truncated}`);
    remaining -= Math.min(content.length, limit);
  }

  return [
    workspacePath
      ? `Workspace root: ${workspacePath}`
      : "Workspace root: (none; active document and explicitly approved files only)",
    "Workspace text-file inventory:",
    inventory,
    "Automatic discovery skips hidden files, credential files, build output, and dependencies, and uses bounded directory and text budgets. The inventory may be incomplete.",
    sections.length > 0
      ? `Relevant workspace file contents:\n\n${sections.join("\n\n---\n\n")}`
      : "",
    "Use the workspace paths above. If the user asks to edit a paper or address feedback, inspect the listed feedback/review file and the relevant .typ source before claiming the files are unavailable.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
