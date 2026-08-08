import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import {
  BookOpen,
  Clipboard,
  Option,
  PenLine,
  ArrowUp,
  Sparkles,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEditorStore, useActiveTab, type AiMessage } from "../../stores/editorStore";
import {
  getAcademicWorkflowPrompt,
  getGraphemeActionSystemPrompt,
  getGraphemeWritingSystemPrompt,
  isReadOnlyAcademicMode,
  type AcademicWorkflowMode,
} from "../../lib/agent/graphemeWritingPrompt";
import {
  filterSlashCommands,
  type GraphemeSlashCommand,
} from "../../lib/agent/slashCommands";
import { getAgentForWorkflow } from "../../lib/agent/agents";
import { loadWorkspaceAiContext } from "../../lib/agent/workspaceContext";
import matrixLoaderSvg from "../../../matrix-loader-effect.svg?raw";
import "./AIChatPanel.css";

const svgToDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const matrixLoaderDarkUrl = svgToDataUrl(matrixLoaderSvg);
const matrixLoaderLightUrl = svgToDataUrl(matrixLoaderSvg.replace(/#261D10/g, "#FFFFFF"));

interface CitationAuthor {
  name: string;
}

interface CitationResult {
  paperId: string;
  title: string | null;
  authors: CitationAuthor[];
  year: number | null;
  abstract: string | null;
  citationCount: number | null;
  externalIds: { DOI?: string } | null;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ChatMode = "plan" | "action";

const ACADEMIC_MODES: { id: AcademicWorkflowMode; label: string }[] = [
  { id: "general", label: "Chat" },
  { id: "clarify", label: "Clarify" },
  { id: "research", label: "Research" },
  { id: "outline", label: "Outline" },
  { id: "draft", label: "Draft" },
  { id: "review", label: "Review" },
  { id: "revise", label: "Revise" },
  { id: "citation-audit", label: "Citations" },
];

const EMPTY_STARTERS = [
  {
    title: "Clarify question",
    body: "Scope a research question before drafting.",
    prompt: "Help me scope this research topic: ",
    mode: "clarify" as const,
  },
  {
    title: "Plan a paper",
    body: "Build an evidence-aware outline for approval.",
    prompt: "Create an outline and argument blueprint for: ",
    mode: "outline" as const,
  },
  {
    title: "Improve selection",
    body: "Make selected text clearer without changing the claim.",
    prompt: "Improve the selected text for clarity, flow, and academic tone.",
    mode: "revise" as const,
  },
  {
    title: "Find sources",
    body: "Search papers and prepare BibTeX-ready citations.",
    prompt: "/cite ",
    mode: "research" as const,
  },
  {
    title: "Review draft",
    body: "Get a read-only academic review and revision roadmap.",
    prompt: "Review this manuscript and produce a revision roadmap.",
    mode: "review" as const,
  },
];

const CLAUDE_MODELS = [
  { id: "claude-opus-4-7",           label: "Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const CODEX_MODELS = [{ id: "", label: "Default Codex model" }];

type ActionEdit =
  | { kind: "replace_selection"; text: string }
  | { kind: "insert_at_cursor"; text: string }
  | { kind: "replace_document"; text: string };

interface AccessRequest {
  message: string;
  paths: string[];
}

function extractAbsolutePaths(text: string): string[] {
  const matches = text.match(/(?:\/(?:Users|private|tmp|Volumes)\/[^\s"'<>]+|[A-Za-z]:\\[^\s"'<>]+)/g) ?? [];
  return [...new Set(matches.map((path) => path.replace(/[.,!?;:)\]]+$/, "")))];
}

function isWithinPath(path: string, root: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function findUnapprovedExternalPaths(
  text: string,
  workspacePath: string | null,
  approvedPaths: readonly string[],
): string[] {
  return extractAbsolutePaths(text)
    .filter((path) => !workspacePath || !isWithinPath(path, workspacePath))
    .filter((path) => !approvedPaths.some((approved) => isWithinPath(path, approved)));
}

function generateBibKey(paper: CitationResult): string {
  const firstAuthor = paper.authors[0]?.name ?? "unknown";
  const lastName = firstAuthor.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
  return `${lastName}${paper.year ?? "nd"}`;
}

function generateBibEntry(paper: CitationResult): string {
  const key = generateBibKey(paper);
  const authors = paper.authors.map((a) => a.name).join(" and ");
  const doi = paper.externalIds?.DOI ? `  doi = {${paper.externalIds.DOI}},\n` : "";
  return `@article{${key},\n  title = {${paper.title ?? ""}},\n  author = {${authors}},\n  year = {${paper.year ?? ""}},\n${doi}}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function extractTaggedText(source: string, tag: ActionEdit["kind"]): string | null {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].replace(/^\n/, "").replace(/\n$/, "") : null;
}

function parseActionEdit(response: string): ActionEdit | null {
  for (const kind of ["replace_selection", "insert_at_cursor", "replace_document"] as const) {
    const text = extractTaggedText(response, kind);
    if (text !== null) return { kind, text };
  }
  return null;
}

function isMarkdownBlockStart(line: string) {
  return /^(```|#{1,6}\s+|>\s?|[-*]\s+|\d+[.)]\s+)/.test(line.trimStart());
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInlineMarkdown(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{renderInlineMarkdown(token.slice(1, -1), `${key}-em`)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      nodes.push(link ? (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {renderInlineMarkdown(link[1], `${key}-link`)}
        </a>
      ) : token);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineMarkdownWithBreaks(text: string, keyPrefix: string) {
  return text.split("\n").flatMap((line, index) => [
    ...(index > 0 ? [<br key={`${keyPrefix}-br-${index}`} />] : []),
    ...renderInlineMarkdown(line, `${keyPrefix}-${index}`),
  ]);
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fence = trimmed.match(/^```(\S*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`code-${i}`} data-language={fence[1] || undefined}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      blocks.push(
        <div key={`h-${i}`} className={`ai-chat-md-heading ai-chat-md-heading--${level}`}>
          {renderInlineMarkdown(heading[2], `h-${i}`)}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`quote-${i}`}>
          {renderInlineMarkdownWithBreaks(quoteLines.join("\n"), `quote-${i}`)}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`}>
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ul-${i}-${idx}`)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`}>
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ol-${i}-${idx}`)}</li>)}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !isMarkdownBlockStart(lines[i])) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`}>
        {renderInlineMarkdownWithBreaks(paragraphLines.join("\n"), `p-${i}`)}
      </p>
    );
  }

  return <div className="ai-chat-markdown">{blocks}</div>;
}

export function AIChatPanel() {
  // ── Sessions from store ────────────────────────────────────────────────
  const theme               = useEditorStore((s) => s.theme);
  const chatSessions        = useEditorStore((s) => s.chatSessions);
  const activeChatSessionId = useEditorStore((s) => s.activeChatSessionId);
  const createChatSession     = useEditorStore((s) => s.createChatSession);
  const setActiveChatSession  = useEditorStore((s) => s.setActiveChatSession);
  const updateChatSession     = useEditorStore((s) => s.updateChatSession);
  const updateSessionClaudeId = useEditorStore((s) => s.updateSessionClaudeId);
  const updateSessionCodexId = useEditorStore((s) => s.updateSessionCodexId);
  const renameChatSession     = useEditorStore((s) => s.renameChatSession);
  const forkChatSession       = useEditorStore((s) => s.forkChatSession);
  const deleteChatSession     = useEditorStore((s) => s.deleteChatSession);

  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId) ?? null;
  const matrixLoaderUrl = theme === "dark" ? matrixLoaderDarkUrl : matrixLoaderLightUrl;

  // ── Local view state ───────────────────────────────────────────────────
  const showAiSessions = useEditorStore((s) => s.showAiSessions);
  const setShowAiSessions = useEditorStore((s) => s.setShowAiSessions);
  const [sessionSearch, setSessionSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cliStatus, setCliStatus] = useState<"checking" | "ready" | "not_found">("checking");
  // Local messages: mirrors active session + live streaming turn
  const [localMessages, setLocalMessages] = useState<AiMessage[]>(activeSession?.messages ?? []);
  const [input, setInput] = useState("");
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingHint, setThinkingHint] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [contextTokens, setContextTokens] = useState<{ used: number; window: number } | null>(null);
  const [citationResults, setCitationResults] = useState<CitationResult[] | null>(null);
  const [isCiteMode, setIsCiteMode] = useState(false);
  const [accessRequest, setAccessRequest] = useState<AccessRequest | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInputRef = useRef("");
  const requestStartRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<boolean>(false);
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;

  // ── Toolbar state ──────────────────────────────────────────────────────
  const [effort, setEffort] = useState<Effort>("medium");
  const [thinking, setThinking] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("plan");
  const [academicMode, setAcademicMode] = useState<AcademicWorkflowMode>("general");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const isReadOnlyMode = isReadOnlyAcademicMode(academicMode);
  const isActionDisabled = isReadOnlyMode;
  const isActionMode = chatMode === "action" && !isActionDisabled;
  const baseSystemPrompt =
    isActionMode
      ? getGraphemeActionSystemPrompt(academicMode)
      : getGraphemeWritingSystemPrompt(academicMode);
  const activeAgent = getAgentForWorkflow(academicMode, isActionMode);
  const systemPrompt = `${activeAgent.prompt}\n\n${baseSystemPrompt}`;
  const slashCommands = filterSlashCommands(input);
  const showSlashCommands = !isLoading && slashCommands.length > 0;

  // ── Provider settings ──────────────────────────────────────────────────
  const selectedText = useEditorStore((s) => s.selectedText);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const aiApprovedPaths = useEditorStore((s) => s.aiApprovedPaths);
  const addAiApprovedPath = useEditorStore((s) => s.addAiApprovedPath);
  const activeTab = useActiveTab();
  const aiProvider   = useEditorStore((s) => s.aiProvider);
  const setAiProvider  = useEditorStore((s) => s.setAiProvider);
  const ollamaUrl      = useEditorStore((s) => s.ollamaUrl);
  const ollamaModel    = useEditorStore((s) => s.ollamaModel);
  const setOllamaModel = useEditorStore((s) => s.setOllamaModel);
  const claudeModel    = useEditorStore((s) => s.claudeModel);
  const setClaudeModel = useEditorStore((s) => s.setClaudeModel);

  // ── Check Claude CLI on mount ──────────────────────────────────────────
  useEffect(() => {
    if (aiProvider === "claude-cli" || aiProvider === "codex-cli") {
      setCliStatus("checking");
      invoke<string>(aiProvider === "codex-cli" ? "check_codex_cli" : "check_claude_cli")
        .then((s) => setCliStatus(s as "ready" | "not_found"))
        .catch(() => setCliStatus("not_found"));
    } else {
      setCliStatus("ready");
    }
  }, [aiProvider]);

  // ── Fetch Ollama models ────────────────────────────────────────────────
  useEffect(() => {
    invoke<string[]>("list_ollama_models", { baseUrl: ollamaUrl })
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
  }, [ollamaUrl]);

  // Sync local messages when active session changes (panel switch or session switch)
  useEffect(() => {
    setLocalMessages(activeSession?.messages ?? []);
    setCitationResults(null);
    setIsCiteMode(false);
    setHistoryIndex(-1);
  }, [activeChatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commit local messages back to the store when streaming finishes or on unmount
  const commitMessages = useCallback((msgs: AiMessage[], options?: { deleteIfEmpty?: boolean }) => {
    if (!activeChatSessionId) return;
    if (msgs.length === 0) {
      if (options?.deleteIfEmpty !== false) deleteChatSession(activeChatSessionId);
    } else {
      updateChatSession(activeChatSessionId, msgs);
    }
  }, [activeChatSessionId, updateChatSession, deleteChatSession]);

  useEffect(() => {
    return () => { commitMessages(localMessagesRef.current, { deleteIfEmpty: false }); };
  }, [commitMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, citationResults]);

  useEffect(() => {
    if (!isLoading) { setThinkingSeconds(0); return; }
    setThinkingSeconds(0);
    const interval = setInterval(() => setThinkingSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // ── Ensure there is an active session without resetting existing chat ──
  useEffect(() => {
    if (activeSession) return;
    if (chatSessions.length > 0) {
      setActiveChatSession(chatSessions[chatSessions.length - 1].id);
    } else {
      createChatSession();
    }
  }, [activeSession, chatSessions, createChatSession, setActiveChatSession]);

  useEffect(() => {
    if (isActionDisabled) setChatMode("plan");
  }, [isActionDisabled]);

  const handleNewSession = useCallback(() => {
    commitMessages(localMessagesRef.current);
    createChatSession();
    setShowAiSessions(false);
  }, [commitMessages, createChatSession, setShowAiSessions]);

  useEffect(() => {
    const onNewSession = () => handleNewSession();
    window.addEventListener("ai:new-session", onNewSession);
    return () => window.removeEventListener("ai:new-session", onNewSession);
  }, [handleNewSession]);

  useEffect(() => {
    const onFocusInput = () => {
      chatInputRef.current?.focus();
    };
    window.addEventListener("ai:focus-input", onFocusInput);
    return () => window.removeEventListener("ai:focus-input", onFocusInput);
  }, []);

  const handleSwitchSession = (id: string) => {
    commitMessages(localMessagesRef.current);
    setActiveChatSession(id);
    setShowAiSessions(false);
  };

  const insertAtCursor = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("editor:insert", { detail: text }));
  }, []);

  const replaceDocument = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("editor:replace-document", { detail: text }));
  }, []);

  const applyActionEdit = useCallback((edit: ActionEdit) => {
    if (edit.kind === "replace_document") {
      replaceDocument(edit.text);
    } else {
      insertAtCursor(edit.text);
    }
  }, [insertAtCursor, replaceDocument]);

  const handleCopyBib = useCallback(async (paper: CitationResult) => {
    await navigator.clipboard.writeText(generateBibEntry(paper));
    setCopiedKey(paper.paperId);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  // ── Toolbar helpers ────────────────────────────────────────────────────
  const modelValue = aiProvider === "claude-cli"
    ? `claude-cli:${claudeModel}`
    : aiProvider === "codex-cli"
      ? "codex-cli:"
    : `ollama:${ollamaModel}`;

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val.startsWith("claude-cli:")) {
      const newModel = val.slice(11);
      setAiProvider("claude-cli");
      setClaudeModel(newModel);
      if (effort === "xhigh" && newModel !== "claude-opus-4-7") setEffort("high");
    } else if (val.startsWith("codex-cli:")) {
      setAiProvider("codex-cli");
      if (effort === "xhigh") setEffort("high");
    } else if (val.startsWith("ollama:")) {
      setAiProvider("ollama");
      setOllamaModel(val.slice(7));
      if (effort === "xhigh") setEffort("high");
    }
  };

  // Estimate tokens in a string: newlines are their own token in BPE tokenizers;
  // remaining characters use the ~4 chars/token rule of thumb.
  const estTokens = (text: string) => {
    const newlines = (text.match(/\n/g) ?? []).length;
    return newlines + Math.ceil((text.length - newlines) / 4);
  };

  // total tokens = input tokens + output tokens
  //   input  = system prompt + user messages (+ 4 per message for role/format overhead)
  //   output = assistant completions (+ 4 per message for role/format overhead)
  const inputTokens =
    estTokens(systemPrompt) +
    localMessages
      .filter((m) => m.role === "user")
      .reduce((sum, m) => sum + estTokens(m.content) + 4, 0);
  const outputTokens =
    localMessages
      .filter((m) => m.role === "assistant")
      .reduce((sum, m) => sum + estTokens(m.content) + 4, 0);

  // Thinking blocks returned in conversation history count toward the next input.
  // Estimate ~50% of the effort budget per completed assistant turn as an average.
  const THINKING_BUDGET: Record<Effort, number> = {
    low: 500, medium: 2_500, high: 5_000, xhigh: 10_000, max: 16_000,
  };
  const completedAssistantTurns = localMessages.filter(
    (m) => m.role === "assistant" && m.content.length > 0
  ).length;
  const thinkingTokens = thinking ? completedAssistantTurns * THINKING_BUDGET[effort] : 0;

  const estimatedTokens = inputTokens + outputTokens + thinkingTokens;
  const contextPct = contextTokens
    ? (contextTokens.used / contextTokens.window) * 100
    : (estimatedTokens / 200_000) * 100;
  const contextPctDisplay = contextPct < 1
    ? contextPct.toFixed(1)
    : Math.min(99, Math.round(contextPct)).toString();

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = async (messageOverride?: string, approvedPathsOverride?: string[]) => {
    const trimmed = (messageOverride ?? input).trim();
    if (!trimmed || isLoading) return;
    const approvedPaths = approvedPathsOverride ?? aiApprovedPaths;

    if (!messageOverride) {
      const externalPaths = findUnapprovedExternalPaths(trimmed, workspacePath, approvedPaths);
      if (externalPaths.length > 0) {
        setAccessError(null);
        setAccessRequest({ message: trimmed, paths: externalPaths });
        return;
      }
    }

    setInput("");
    setHistoryIndex(-1);

    // Citation search
    if (trimmed.startsWith("/cite ")) {
      const query = trimmed.slice(6).trim();
      if (!query) return;
      setIsCiteMode(true);
      setCitationResults(null);
      const now = Date.now();
      const next: AiMessage[] = [...localMessages, { role: "user", content: trimmed, timestamp: now }];
      setLocalMessages(next);
      setIsLoading(true);
      try {
        const results = await invoke<CitationResult[]>("search_citations", { query });
        setCitationResults(results);
        const withReply: AiMessage[] = [
          ...next,
          {
            role: "assistant",
            content: results.length === 0
              ? "No results found."
              : `Found ${results.length} papers, ranked by citation count.`,
            timestamp: Date.now(),
          },
        ];
        setLocalMessages(withReply);
        commitMessages(withReply);
      } catch (e) {
        setCitationResults([]);
        const withErr: AiMessage[] = [...next, { role: "assistant", content: `Citation search failed: ${String(e)}`, timestamp: Date.now() }];
        setLocalMessages(withErr);
        commitMessages(withErr);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // AI chat
    setIsCiteMode(false);
    setCitationResults(null);

    if ((aiProvider === "claude-cli" || aiProvider === "codex-cli") && cliStatus !== "ready") {
      const msgs: AiMessage[] = [
        ...localMessages,
        { role: "user", content: trimmed },
        { role: "assistant", content: aiProvider === "codex-cli"
          ? "Codex CLI not found. Install Codex and run `codex login` to authenticate."
          : "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code, then run `claude` to authenticate." },
      ];
      setLocalMessages(msgs);
      commitMessages(msgs);
      return;
    }

    let contextualContent = trimmed;
    const workspaceContext = await loadWorkspaceAiContext(
      workspacePath,
      activeTab?.path ?? null,
      activeTab?.content ?? null,
      approvedPaths,
    );
    if (isActionMode) {
      contextualContent =
        `${systemPrompt}\n\n` +
        `User request:\n${trimmed}\n\n` +
        `Active document path: ${activeTab?.path ?? "(untitled)"}\n\n` +
        `Current document:\n\`\`\`\n${activeTab?.content ?? ""}\n\`\`\``;
      if (selectedText) {
        contextualContent += `\n\nSelected text:\n\`\`\`\n${selectedText}\n\`\`\``;
      }
    } else if (academicMode !== "general") {
      contextualContent = `${getAcademicWorkflowPrompt(academicMode)}\n\nUser request:\n${trimmed}`;
      if (selectedText) {
        contextualContent += `\n\nSelected text:\n\`\`\`\n${selectedText}\n\`\`\``;
      }
      if (isReadOnlyMode) {
        contextualContent +=
          `\n\nActive document path: ${activeTab?.path ?? "(untitled)"}\n\n` +
          `Current document:\n\`\`\`\n${activeTab?.content ?? ""}\n\`\`\``;
      }
    } else if (selectedText) {
      contextualContent += `\n\nSelected text:\n\`\`\`\n${selectedText}\n\`\`\``;
    }
    if (workspaceContext) {
      contextualContent += `\n\n${workspaceContext}`;
    }

    const withUser: AiMessage[] = [...localMessages, { role: "user", content: trimmed, timestamp: Date.now() }];
    const withPlaceholder: AiMessage[] = [...withUser, { role: "assistant", content: "" }];
    setLocalMessages(withPlaceholder);

    setIsLoading(true);
    abortRef.current = false;
    setThinkingHint(null);
    requestStartRef.current = Date.now();

    try {
      if (aiProvider === "ollama") {
        const apiMessages = [
          ...localMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: contextualContent },
        ];
        const onChunk = new Channel<string>();
        onChunk.onmessage = (chunk: string) => {
          if (abortRef.current) return;
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (copy[copy.length - 1]?.content ?? "") + chunk,
            };
            return copy;
          });
        };
        await invoke("stream_ai_chat", {
          messages: apiMessages,
          ollamaUrl,
          ollamaModel,
          system: systemPrompt,
          onChunk,
        });
      } else {
        // CLI providers are session-based, so history is resumed by the backend.
        const onChunk = new Channel<string>();
        onChunk.onmessage = (chunk: string) => {
          if (abortRef.current) return;
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (copy[copy.length - 1]?.content ?? "") + chunk,
            };
            return copy;
          });
        };

        const onStatus = new Channel<string>();
        onStatus.onmessage = (msg: string) => {
          if (abortRef.current) return;
          try {
            const ev = JSON.parse(msg) as { t: string; text?: string; used?: number; window?: number };
            if (ev.t === "thinking" && ev.text) setThinkingHint(ev.text);
            else if (ev.t === "usage" && ev.used && ev.window) setContextTokens({ used: ev.used, window: ev.window });
          } catch {
            setThinkingHint(msg);
          }
        };

        const isCodex = aiProvider === "codex-cli";
        const returnedSessionId = await invoke<string | null>(isCodex ? "stream_codex_cli" : "stream_claude_cli", isCodex
          ? {
              sessionId: activeSession?.codexSessionId ?? null,
              message: contextualContent,
              system: activeSession?.codexSessionId ? "" : systemPrompt,
              model: null,
              effort,
              cwd: workspacePath ?? (activeTab?.path ? activeTab.path.split("/").slice(0, -1).join("/") || null : null),
              onChunk,
              onStatus,
            }
          : {
              sessionId: activeSession?.claudeSessionId ?? null,
              message: contextualContent,
              system: activeSession?.claudeSessionId ? "" : systemPrompt,
              model: claudeModel || null,
              effort,
              thinking,
              onChunk,
              onStatus,
            });

        if (returnedSessionId && activeChatSessionId) {
          if (isCodex) updateSessionCodexId(activeChatSessionId, returnedSessionId);
          else updateSessionClaudeId(activeChatSessionId, returnedSessionId);
        }
      }

      const finishedAt = Date.now();
      const elapsed = finishedAt - requestStartRef.current;
      const finalMsgs = localMessagesRef.current.map((m, i, arr) =>
        i === arr.length - 1 && m.role === "assistant" && !m.timestamp
          ? { ...m, timestamp: finishedAt, elapsed }
          : m
      );
      setLocalMessages(finalMsgs);
      commitMessages(finalMsgs);

      const lastReply = finalMsgs[finalMsgs.length - 1];
      if (
        lastReply?.role === "assistant" &&
        /\b(permission|access|outside|allow|unavailable|cannot)\b/i.test(lastReply.content)
      ) {
        const responsePaths = findUnapprovedExternalPaths(lastReply.content, workspacePath, approvedPaths);
        if (responsePaths.length > 0) {
          setAccessError(null);
          setAccessRequest({ message: trimmed, paths: responsePaths });
        }
      }

      if (isActionMode) {
        const last = finalMsgs[finalMsgs.length - 1];
        const edit = last?.role === "assistant" ? parseActionEdit(last.content) : null;
        const actionMsgs = finalMsgs.map((m, i) => {
          if (i !== finalMsgs.length - 1 || m.role !== "assistant") return m;
          return {
            ...m,
            content: edit
              ? `Applied ${edit.kind.replace(/_/g, " ")}.`
              : "Act mode could not find a valid edit operation. No editor change was made.",
          };
        });
        setLocalMessages(actionMsgs);
        commitMessages(actionMsgs);
        if (edit) applyActionEdit(edit);
      }
    } catch (e: unknown) {
      if (!abortRef.current) {
        const errMsgs = localMessagesRef.current.map((m, i, arr) =>
          i === arr.length - 1 && m.role === "assistant"
            ? { ...m, content: `Error: ${String(e)}`, timestamp: Date.now() }
            : m
        );
        setLocalMessages(errMsgs);
        commitMessages(errMsgs);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    if (!accessRequest) return;
    setAccessError(null);
    const approved: string[] = [];
    try {
      for (const path of accessRequest.paths) {
        await invoke("approve_path", { path });
        addAiApprovedPath(path);
        approved.push(path);

        // Open the requested paper in Grapheme so Act mode can apply the edit
        // through the normal editor/save pipeline.
        if (/\.typ$/i.test(path)) {
          const content = await invoke<string>("read_file", { path });
          const name = path.split(/[\\/]/).pop() ?? "paper.typ";
          useEditorStore.getState().openTab(path, name, content);
        }
      }
      const request = accessRequest;
      const nextApproved = [...aiApprovedPaths, ...approved];
      setAccessRequest(null);
      await handleSend(request.message, [...new Set(nextApproved)]);
    } catch (error) {
      setAccessError(`Could not grant access: ${String(error)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashCommands) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashCommandIndex((current) => {
          const offset = e.key === "ArrowDown" ? 1 : -1;
          return (current + offset + slashCommands.length) % slashCommands.length;
        });
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        applySlashCommand(slashCommands[slashCommandIndex] ?? slashCommands[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const el = e.currentTarget;
      const userMessages = localMessages.filter((m) => m.role === "user").map((m) => m.content);
      if (userMessages.length === 0) return;

      if (e.key === "ArrowUp" && el.selectionStart === 0) {
        e.preventDefault();
        if (historyIndex === -1) savedInputRef.current = input;
        const newIdx = historyIndex === -1 ? userMessages.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setInput(userMessages[newIdx]);
      } else if (e.key === "ArrowDown" && historyIndex !== -1) {
        e.preventDefault();
        const newIdx = historyIndex + 1;
        if (newIdx >= userMessages.length) {
          setHistoryIndex(-1);
          setInput(savedInputRef.current);
        } else {
          setHistoryIndex(newIdx);
          setInput(userMessages[newIdx]);
        }
      }
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    invoke("cancel_ai_stream").catch(() => {});
    setIsLoading(false);
    commitMessages(localMessagesRef.current);
  };

  const applyPrompt = (prompt: string, mode: AcademicWorkflowMode) => {
    setAcademicMode(mode);
    setInput(prompt);
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      const len = prompt.length;
      chatInputRef.current?.setSelectionRange(len, len);
    });
  };

  const applySlashCommand = (command: GraphemeSlashCommand) => {
    setSlashCommandIndex(0);
    applyPrompt(command.prompt, command.mode);
  };

  // ── Session list helpers ───────────────────────────────────────────────
  function dateGroup(ts: number): string {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= todayStart) return "Today";
    if (ts >= todayStart - 86400000) return "Yesterday";
    if (ts >= todayStart - 6 * 86400000) return "This week";
    return "Older";
  }

  const filteredSessions = [...chatSessions]
    .reverse()
    .filter((s) => s.title.toLowerCase().includes(sessionSearch.toLowerCase()));

  const grouped = filteredSessions.reduce<Record<string, typeof filteredSessions>>((acc, sess) => {
    const g = dateGroup(sess.createdAt);
    (acc[g] ??= []).push(sess);
    return acc;
  }, {});

  const GROUP_ORDER = ["Today", "Yesterday", "This week", "Older"];

  const commitRename = () => {
    if (renamingId) renameChatSession(renamingId, renameValue);
    setRenamingId(null);
  };

  // ── Sessions list view ─────────────────────────────────────────────────
  if (showAiSessions) {
    return (
      <div className="ai-chat-panel">
        <div className="ai-sessions-header">
          <button className="ai-sessions-back" onClick={() => setShowAiSessions(false)}>← Back</button>
          <span className="ai-sessions-header-title">Chats</span>
          <button className="ai-chat-btn ai-chat-btn--send ai-sessions-new" onClick={handleNewSession}>+ New</button>
        </div>

        <div className="ai-sessions-search-row">
          <input
            className="ai-sessions-search"
            placeholder="Search chats…"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
          />
        </div>

        <div className="ai-sessions-list">
          {filteredSessions.length === 0 && (
            <div className="ai-sessions-empty">
              {sessionSearch ? "No matching chats." : "No chats yet."}
            </div>
          )}

          {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
            <div key={group} className="ai-sessions-group">
              <div className="ai-sessions-group-label">{group}</div>
              {grouped[group].map((sess) => {
                const lastMsg = [...sess.messages].reverse().find((m) => m.role === "assistant");
                const isActive = sess.id === activeChatSessionId;
                const isRenaming = renamingId === sess.id;
                return (
                  <div
                    key={sess.id}
                    className={`ai-session-item${isActive ? " ai-session-item--active" : ""}`}
                    onClick={() => !isRenaming && handleSwitchSession(sess.id)}
                  >
                    <div className="ai-session-item-main">
                      {isRenaming ? (
                        <input
                          className="ai-session-rename-input"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenamingId(null);
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div
                          className="ai-session-item-title"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(sess.id);
                            setRenameValue(sess.title);
                          }}
                          title="Double-click to rename"
                        >
                          {sess.title}
                        </div>
                      )}
                      {lastMsg && !isRenaming && (
                        <div className="ai-session-item-preview">
                          {lastMsg.content.slice(0, 80)}{lastMsg.content.length > 80 ? "…" : ""}
                        </div>
                      )}
                      <div className="ai-session-item-meta">
                        {formatDate(sess.createdAt)} · {sess.messages.length} msg{sess.messages.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="ai-session-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="ai-session-action-btn"
                        onClick={() => { forkChatSession(sess.id); setShowAiSessions(false); }}
                        title="Fork session"
                      >
                        <Option size={12} />
                      </button>
                      <button
                        className="ai-session-action-btn ai-session-action-btn--delete"
                        onClick={() => deleteChatSession(sess.id)}
                        title="Delete session"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────────────
  return (
    <div className="ai-chat-panel">
      {(aiProvider === "claude-cli" || aiProvider === "codex-cli") && cliStatus !== "ready" && (
        <div className={`ai-cli-banner ai-cli-banner--${cliStatus}`}>
          {cliStatus === "checking" ? `Checking ${aiProvider === "codex-cli" ? "Codex" : "Claude"} CLI…` : (
            <>
              {aiProvider === "codex-cli" ? "Codex CLI not found. Install Codex and run `codex login` to log in." : <>Claude CLI not found.{" "}
                <a href="https://claude.ai/download" target="_blank" rel="noreferrer">Install Claude</a>
                {" "}and run <code>claude</code> to log in.</>}
            </>
          )}
        </div>
      )}

      {accessRequest && (
        <div className="ai-access-request" role="alert">
          <div className="ai-access-request-icon"><ShieldCheck size={16} /></div>
          <div className="ai-access-request-copy">
            <div className="ai-access-request-title">Grapheme needs permission to use these files</div>
            <div className="ai-access-request-help">
              These paths are outside the currently open workspace. Access is limited to the exact paths you approve.
            </div>
            <ul className="ai-access-request-paths">
              {accessRequest.paths.map((path) => <li key={path}><code>{path}</code></li>)}
            </ul>
            {accessError && <div className="ai-access-request-error">{accessError}</div>}
            <div className="ai-access-request-actions">
              <button className="ai-access-request-approve" onClick={handleGrantAccess}>Grant access and continue</button>
              <button className="ai-access-request-cancel" onClick={() => { setAccessRequest(null); setAccessError(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="ai-chat-messages">
        {localMessages.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-kicker">
              <Sparkles size={15} />
              Essay copilot
            </div>
            <div className="ai-starter-grid">
              {EMPTY_STARTERS.map((starter) => (
                <button
                  key={starter.title}
                  className="ai-starter-card"
                  onClick={() => applyPrompt(starter.prompt, starter.mode)}
                >
                  <span className="ai-starter-title">{starter.title}</span>
                  <span className="ai-starter-body">{starter.body}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {localMessages.map((msg, i) => {
          const isThinking =
            isLoading &&
            i === localMessages.length - 1 &&
            msg.role === "assistant" &&
            msg.content === "";
          const showFooter = msg.role === "assistant" && msg.content && !isThinking;
          return (
            <div key={i} className={`ai-chat-message ai-chat-message--${msg.role}`}>
              {isThinking ? (
                <div className="ai-chat-message-body ai-thinking-body">
                  <div className="ai-thinking-status">
                    <img className="ai-thinking-loader" src={matrixLoaderUrl} alt="" aria-hidden="true" />
                    <div className="ai-thinking-label">Thinking {thinkingSeconds}s</div>
                  </div>
                  {thinkingHint && (
                    <div className="ai-thinking-hint">{thinkingHint}{thinkingHint.length >= 200 ? "…" : ""}</div>
                  )}
                </div>
              ) : (
                <div className="ai-chat-message-body">
                  <MarkdownMessage content={msg.content} />
                </div>
              )}
              {showFooter && (
                <div className="ai-msg-footer">
                  <span className="ai-msg-time">
                    {msg.timestamp ? formatTime(msg.timestamp) : ""}
                    {msg.elapsed != null ? ` · ${(msg.elapsed / 1000).toFixed(1)}s` : ""}
                  </span>
                  <div className="ai-msg-actions">
                    <button
                      className="ai-msg-action-btn"
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      title="Copy"
                    >
                      <Clipboard size={14} />
                    </button>
                    {!msg.content.startsWith("Found ") && !msg.content.startsWith("No results") && (
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => insertAtCursor(msg.content)}
                        title="Insert at cursor"
                      >
                        <PenLine size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {isCiteMode && citationResults && citationResults.length > 0 && (
          <div className="ai-cite-results">
            {citationResults.map((paper) => (
              <div key={paper.paperId} className="ai-cite-card">
                <div className="ai-cite-card-title">{paper.title ?? "(no title)"}</div>
                <div className="ai-cite-card-meta">
                  {paper.authors.slice(0, 3).map((a) => a.name).join(", ")}
                  {paper.authors.length > 3 && " et al."}
                  {paper.year ? ` · ${paper.year}` : ""}
                  {` · ${paper.citationCount ?? 0} citations`}
                </div>
                {paper.abstract && (
                  <div className="ai-cite-card-abstract">
                    {paper.abstract.slice(0, 180)}
                    {paper.abstract.length > 180 ? "…" : ""}
                  </div>
                )}
                <div className="ai-cite-card-actions">
                  <button
                    className="ai-cite-btn"
                    onClick={() => insertAtCursor(`@${generateBibKey(paper)}`)}
                    title="Insert @key citation at cursor"
                  >
                    Insert @{generateBibKey(paper)}
                  </button>
                  <button
                    className="ai-cite-btn ai-cite-btn--secondary"
                    onClick={() => handleCopyBib(paper)}
                    title="Copy BibTeX entry to clipboard"
                  >
                    {copiedKey === paper.paperId ? "Copied!" : "Copy BibTeX"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {selectedText && (
        <div className="ai-context-badge" title={selectedText}>
          <span className="ai-context-label">
            <BookOpen size={13} />
            Selection
          </span>
          <span className="ai-context-text">
            {selectedText.slice(0, 80)}
            {selectedText.length > 80 ? "…" : ""}
          </span>
        </div>
      )}

      <div className="ai-chat-input-area">
        {showSlashCommands && (
          <div className="ai-slash-menu" role="listbox" aria-label="Writing modes">
            {slashCommands.map((command, index) => (
              <button
                key={command.command}
                className={`ai-slash-menu-item${index === slashCommandIndex ? " ai-slash-menu-item--active" : ""}`}
                type="button"
                role="option"
                aria-selected={index === slashCommandIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySlashCommand(command)}
              >
                <span className="ai-slash-menu-command">/{command.command}</span>
                <span className="ai-slash-menu-copy">
                  <span className="ai-slash-menu-label">{command.label}</span>
                  <span className="ai-slash-menu-description">{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="ai-chat-composer">
          <textarea
            ref={chatInputRef}
            className="ai-chat-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSlashCommandIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedText ? "Tell AI what to do with the selection…" : "Ask for drafting, editing, rephrasing, or /cite query"}
            rows={3}
            disabled={isLoading}
          />
          <div className="ai-chat-input-actions">
            <select
              className="ai-toolbar-select"
              value={academicMode}
              onChange={(e) => setAcademicMode(e.target.value as AcademicWorkflowMode)}
              title="Academic workflow mode"
            >
              {ACADEMIC_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>

            <span className="ai-toolbar-sep" />

            <select
              className="ai-toolbar-model"
              value={modelValue}
              onChange={handleModelChange}
              title="Model"
            >
              <optgroup label="Codex">
                {CODEX_MODELS.map((m) => (
                  <option key={m.id} value={`codex-cli:${m.id}`}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="Claude">
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={`claude-cli:${m.id}`}>{m.label}</option>
                ))}
              </optgroup>
              {ollamaModels.length > 0 && (
                <optgroup label="Ollama (local)">
                  {ollamaModels.map((m) => (
                    <option key={m} value={`ollama:${m}`}>{m}</option>
                  ))}
                  {aiProvider === "ollama" && !ollamaModels.includes(ollamaModel) && (
                    <option value={`ollama:${ollamaModel}`}>{ollamaModel}</option>
                  )}
                </optgroup>
              )}
            </select>

            <span className="ai-toolbar-sep" />

            <select
              className="ai-toolbar-select"
              value={effort}
              onChange={(e) => setEffort(e.target.value as Effort)}
              title="Effort"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              {claudeModel === "claude-opus-4-7" && (
                <option value="xhigh">XHigh</option>
              )}
              <option value="max">Max</option>
            </select>

            <button
              className={`ai-think-btn${thinking ? " active" : ""}`}
              onClick={() => setThinking((t) => !t)}
              title={thinking ? "Thinking on" : "Thinking off"}
            >
              ◑
            </button>

            <span
              className="ai-toolbar-tokens"
              data-tooltip={contextTokens
                ? `${Math.round(contextTokens.used / 1000)}k / ${Math.round(contextTokens.window / 1000)}k tokens (API)`
                : `~${Math.round(estimatedTokens / 1000)}k / 200k tokens (est.${thinking && thinkingTokens > 0 ? ` incl. ~${Math.round(thinkingTokens / 1000)}k thinking` : ""})`}
            >
              {contextPctDisplay}%
            </span>

            <span className="ai-toolbar-spacer" />

            <span className="ai-toolbar-label">Act</span>
            <label
              className={`ai-mode-toggle${isActionDisabled ? " ai-mode-toggle--disabled" : ""}`}
              title={isActionDisabled ? "Review and citation audit are read-only" : chatMode === "action" ? "Auto-insert on" : "Auto-insert off"}
            >
              <input
                type="checkbox"
                checked={isActionMode}
                disabled={isActionDisabled}
                onChange={(e) => setChatMode(e.target.checked ? "action" : "plan")}
              />
              <span className="ai-mode-toggle-track" />
            </label>

            <span className="ai-toolbar-sep" />

            {isLoading ? (
              <button className="ai-chat-btn ai-chat-btn--stop" onClick={handleStop}>Stop</button>
            ) : (
              <button className="ai-chat-btn ai-chat-btn--send" onClick={() => handleSend()} disabled={!input.trim()} aria-label="Send">
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
