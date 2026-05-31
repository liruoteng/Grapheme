export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolResult<T = unknown> {
  data: T;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolUseContext {
  abortSignal?: AbortSignal;
  paperId?: string;
}

export interface Tool<Input = Record<string, unknown>, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  call(
    input: Input,
    context: ToolUseContext,
  ): Promise<ToolResult<Output>>;
  isReadOnly(input: Input): boolean;
  prompt(): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tools = readonly Tool<any, any>[];

export interface LLMStreamEvent {
  type: "text_delta" | "tool_call" | "done";
  text?: string;
  toolCall?: ToolCall;
}

export interface LLMProvider {
  chat(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent>;
}

export type PaperPhase =
  | "idle"
  | "research"
  | "outlining"
  | "drafting"
  | "reviewing"
  | "polishing"
  | "complete";

export interface Citation {
  id: string;
  bibKey: string;
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  bibEntry: string;
}

export interface PaperSection {
  id: string;
  title: string;
  content: string;
  level: number;
  parentId?: string;
  status: "pending" | "drafting" | "review" | "complete";
}

export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  children: OutlineNode[];
  sectionId?: string;
}

export interface PaperState {
  id: string;
  title: string;
  abstract: string;
  sections: PaperSection[];
  citations: Citation[];
  outline: OutlineNode[];
  phase: PaperPhase;
  targetJournal?: string;
  citationStyle: string;
  revisionLog: RevisionEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface RevisionEntry {
  id: string;
  sectionId: string;
  description: string;
  timestamp: number;
  before: string;
  after: string;
}
