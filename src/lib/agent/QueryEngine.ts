import type {
  AgentInfo,
  LLMProvider,
  Message,
  Tool,
  ToolCall,
  Tools,
  ToolUseContext,
} from "./types";
import { getToolPermission, type PermissionRequest } from "./permissions";

export interface QueryEngineConfig {
  provider: LLMProvider;
  tools: Tools;
  systemPrompt: string;
  maxTurns?: number;
  context?: ToolUseContext;
  agent?: AgentInfo;
  requestPermission?: (request: PermissionRequest) => Promise<boolean>;
}

export interface QueryResult {
  messages: Message[];
  text: string;
  turnsUsed: number;
  toolCallsMade: number;
  stopReason: "end_turn" | "max_turns" | "error";
  error?: string;
}

export interface QueryEvent {
  type:
    | "text_delta"
    | "tool_call_start"
    | "tool_call_result"
    | "permission_request"
    | "turn_complete"
    | "done";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  permission?: PermissionRequest;
  turn?: number;
}

export class QueryEngine {
  private config: QueryEngineConfig;
  private messages: Message[] = [];
  private abortController: AbortController;
  private running = false;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.abortController = new AbortController();
  }

  async *submitMessage(prompt: string): AsyncGenerator<QueryEvent, QueryResult> {
    if (this.running) throw new Error("An agent response is already running.");
    this.running = true;
    try {
      return yield* this.runMessage(prompt);
    } finally {
      this.running = false;
    }
  }

  private async *runMessage(prompt: string): AsyncGenerator<QueryEvent, QueryResult> {
    const {
      provider,
      tools,
      systemPrompt: baseSystemPrompt,
      maxTurns: configuredMaxTurns,
      context,
      agent,
    } = this.config;
    const systemPrompt = agent ? `${agent.prompt}\n\n${baseSystemPrompt}` : baseSystemPrompt;
    const maxTurns = configuredMaxTurns ?? agent?.steps ?? 20;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const toolContext = { ...context, abortSignal: signal };
    const abortFromContext = () => this.abortController.abort(context?.abortSignal?.reason);
    if (context?.abortSignal?.aborted) abortFromContext();
    context?.abortSignal?.addEventListener("abort", abortFromContext, { once: true });

    try {
      signal.throwIfAborted();

      this.messages.push({ role: "user", content: prompt });

      let turnsUsed = 0;
      let toolCallsMade = 0;

      while (turnsUsed < maxTurns) {
        signal.throwIfAborted();
        turnsUsed++;
        let assistantText = "";
        const toolCalls: ToolCall[] = [];

        for await (const event of provider.chat(this.messages, tools, systemPrompt, signal)) {
          signal.throwIfAborted();
          if (event.type === "text_delta" && event.text) {
            assistantText += event.text;
            yield { type: "text_delta", text: event.text };
          } else if (event.type === "tool_call" && event.toolCall) {
            toolCalls.push(event.toolCall);
          }
        }

        signal.throwIfAborted();

        const assistantMessage: Message = {
          role: "assistant",
          content: assistantText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        this.messages.push(assistantMessage);

        yield { type: "turn_complete", turn: turnsUsed };

        if (toolCalls.length === 0) {
          const result: QueryResult = {
            messages: this.messages,
            text: assistantText,
            turnsUsed,
            toolCallsMade,
            stopReason: "end_turn",
          };
          yield { type: "done" };
          return result;
        }

        for (const call of toolCalls) {
          signal.throwIfAborted();
          toolCallsMade++;
          const tool = tools.find((candidate) => candidate.name === call.name);

          yield {
            type: "tool_call_start",
            toolName: call.name,
            toolInput: call.input,
          };

          let toolResult: unknown;
          if (!tool) {
            toolResult = { error: `Unknown tool: ${call.name}` };
          } else {
            const permission = agent ? getToolPermission(agent, tool, call.input) : "allow";
            if (permission === "deny") {
              toolResult = { error: `Agent "${agent?.name}" is not allowed to use ${call.name}` };
            } else if (permission === "ask") {
              const request: PermissionRequest = {
                permission: tool.isReadOnly(call.input) ? "read" : "write",
                pattern: call.name,
                agent: agent?.name ?? "default",
                toolName: call.name,
                input: call.input,
              };
              yield { type: "permission_request", permission: request };
              signal.throwIfAborted();
              const approved = this.config.requestPermission
                ? await waitForApproval(this.config.requestPermission(request), signal)
                : false;
              signal.throwIfAborted();
              toolResult = approved
                ? await this.executeTool(call, tool, toolContext)
                : { error: `Permission denied for ${call.name}` };
            } else {
              toolResult = await this.executeTool(call, tool, toolContext);
            }
          }

          signal.throwIfAborted();

          yield {
            type: "tool_call_result",
            toolName: call.name,
            toolResult,
          };

          signal.throwIfAborted();
          this.messages.push({
            role: "tool",
            content: formatToolResult(toolResult),
            toolCallId: call.id,
            name: call.name,
          });
        }
      }

      return {
        messages: this.messages,
        text: "",
        turnsUsed,
        toolCallsMade,
        stopReason: "max_turns",
      };
    } finally {
      context?.abortSignal?.removeEventListener("abort", abortFromContext);
    }
  }

  private async executeTool(
    call: ToolCall,
    tool: Tool | undefined,
    context?: ToolUseContext
  ): Promise<unknown> {
    if (!tool) {
      return { error: `Unknown tool: ${call.name}` };
    }

    try {
      context?.abortSignal?.throwIfAborted();
      const result = await tool.call(call.input, context ?? {});
      if (result.error) {
        return { error: result.error };
      }
      return result.data;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Tool execution failed",
      };
    }
  }

  interrupt(): void {
    this.abortController.abort();
  }

  updateConfig(config: Partial<QueryEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getMessages(): readonly Message[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
  }
}

/** Stop waiting immediately; a late approval can never resume a cancelled run. */
function waitForApproval(approval: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    approval.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
