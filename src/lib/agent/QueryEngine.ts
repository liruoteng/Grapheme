import type {
  LLMProvider,
  Message,
  Tool,
  ToolCall,
  Tools,
  ToolUseContext,
} from "./types";
import { getToolByName } from "./tools";

export interface QueryEngineConfig {
  provider: LLMProvider;
  tools: Tools;
  systemPrompt: string;
  maxTurns?: number;
  context?: ToolUseContext;
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
  type: "text_delta" | "tool_call_start" | "tool_call_result" | "turn_complete" | "done";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  turn?: number;
}

export class QueryEngine {
  private config: QueryEngineConfig;
  private messages: Message[] = [];
  private abortController: AbortController;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.abortController = new AbortController();
  }

  async *submitMessage(prompt: string): AsyncGenerator<QueryEvent, QueryResult> {
    const { provider, tools, systemPrompt, maxTurns = 20, context } = this.config;

    this.messages.push({ role: "user", content: prompt });

    let turnsUsed = 0;
    let toolCallsMade = 0;

    while (turnsUsed < maxTurns) {
      turnsUsed++;
      let assistantText = "";
      const toolCalls: ToolCall[] = [];

      for await (const event of provider.chat(
        this.messages,
        tools,
        systemPrompt,
        this.abortController.signal,
      )) {
        if (event.type === "text_delta" && event.text) {
          assistantText += event.text;
          yield { type: "text_delta", text: event.text };
        } else if (event.type === "tool_call" && event.toolCall) {
          toolCalls.push(event.toolCall);
        }
      }

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
        toolCallsMade++;
        const tool = getToolByName(call.name);

        yield {
          type: "tool_call_start",
          toolName: call.name,
          toolInput: call.input,
        };

        const toolResult = await this.executeTool(call, tool, context);

        yield {
          type: "tool_call_result",
          toolName: call.name,
          toolResult,
        };

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
  }

  private async executeTool(
    call: ToolCall,
    tool: Tool | undefined,
    context?: ToolUseContext,
  ): Promise<unknown> {
    if (!tool) {
      return { error: `Unknown tool: ${call.name}` };
    }

    try {
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

  getMessages(): readonly Message[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
  }
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
