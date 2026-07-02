import { invoke, Channel } from "@tauri-apps/api/core";
import type { LLMProvider, LLMStreamEvent, Message, Tools, JsonSchema } from "./types";
import { DEFAULT_OLLAMA_URL } from "../constants";
import { logger } from "../logger";

export type AiProvider = "claude-cli" | "ollama";

export interface GraphemeProviderConfig {
  provider: AiProvider;
  claudeModel?: string;
  claudeApiKey?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  sessionId?: string | null;
  onSessionId?: (id: string) => void;
}

interface BackendToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

interface RawToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const TOOL_CALL_MARKER = "__TOOL_CALL__:";

function convertTools(tools: Tools): BackendToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function mapMessages(messages: Message[]): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role === "tool" ? "assistant" : m.role,
    content: m.role === "tool" ? `Tool result: ${m.content}` : m.content,
  }));
}

class ToolCallParser {
  private buffer = "";

  feed(chunk: string): LLMStreamEvent[] {
    this.buffer += chunk;
    return this.extract();
  }

  finish(): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = this.extract();
    if (this.buffer.length > 0) {
      events.push({ type: "text_delta", text: this.buffer });
      this.buffer = "";
    }
    return events;
  }

  private extract(): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];

    while (true) {
      const markerIdx = this.buffer.indexOf(TOOL_CALL_MARKER);

      if (markerIdx === -1) {
        const safe = this.safeTextPrefix();
        if (safe.length > 0) {
          events.push({ type: "text_delta", text: safe });
          this.buffer = this.buffer.slice(safe.length);
        }
        return events;
      }

      if (markerIdx > 0) {
        const before = this.buffer.slice(0, markerIdx);
        const text = before.replace(/^\n/, "");
        if (text.length > 0) {
          events.push({ type: "text_delta", text });
        }
      }

      const afterMarker = this.buffer.slice(markerIdx + TOOL_CALL_MARKER.length);
      const newlineIdx = afterMarker.indexOf("\n");
      if (newlineIdx === -1) {
        this.buffer = this.buffer.slice(markerIdx);
        return events;
      }

      const jsonStr = afterMarker.slice(0, newlineIdx).trim();
      this.buffer = afterMarker.slice(newlineIdx + 1);

      try {
        const parsed: RawToolCall = JSON.parse(jsonStr);
        events.push({ type: "tool_call", toolCall: parsed });
      } catch {
        logger.warn("Failed to parse tool call JSON:", jsonStr);
      }
    }
  }

  private safeTextPrefix(): string {
    const maxCheck = Math.min(this.buffer.length, TOOL_CALL_MARKER.length);
    for (let i = 1; i <= maxCheck; i++) {
      const tail = this.buffer.slice(this.buffer.length - i);
      if (TOOL_CALL_MARKER.startsWith(tail) && this.buffer.endsWith(tail)) {
        return this.buffer.slice(0, this.buffer.length - i);
      }
    }
    return this.buffer;
  }
}

export class GraphemeLLMProvider implements LLMProvider {
  private config: GraphemeProviderConfig;

  constructor(config: GraphemeProviderConfig) {
    this.config = config;
  }

  async *chat(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    if (this.config.provider === "ollama") {
      yield* this.chatOllama(messages, tools, systemPrompt, signal);
    } else if (this.config.claudeApiKey) {
      yield* this.chatClaudeApi(messages, tools, systemPrompt, signal);
    } else {
      yield* this.chatClaudeCli(messages, systemPrompt, signal);
    }
  }

  private async *streamWithParser(
    invokeFn: (onChunk: Channel<string>) => Promise<void>,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    const parser = new ToolCallParser();
    const eventQueue: LLMStreamEvent[] = [];
    let resolveEvent: (() => void) | null = null;
    let done = false;

    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk: string) => {
      if (signal?.aborted) return;
      const events = parser.feed(chunk);
      eventQueue.push(...events);
      resolveEvent?.();
    };

    const invokePromise = invokeFn(onChunk).then(() => {
      done = true;
      resolveEvent?.();
    });

    while (!done || eventQueue.length > 0) {
      if (signal?.aborted) {
        await invoke("cancel_ai_stream").catch(() => {});
        break;
      }

      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      } else if (!done) {
        await new Promise<void>((resolve) => {
          resolveEvent = resolve;
        });
      }
    }

    await invokePromise.catch(() => {});

    const remaining = parser.finish();
    for (const event of remaining) {
      yield event;
    }

    yield { type: "done" };
  }

  private chatOllama(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    return this.streamWithParser(async (onChunk) => {
      await invoke("stream_ai_chat_with_tools", {
        messages: mapMessages(messages),
        ollamaUrl: this.config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
        ollamaModel: this.config.ollamaModel ?? "llama3",
        system: systemPrompt,
        tools: convertTools(tools),
        onChunk,
      });
    }, signal);
  }

  private chatClaudeApi(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    return this.streamWithParser(async (onChunk) => {
      const onStatus = new Channel<string>();
      onStatus.onmessage = () => {};
      await invoke("stream_claude_api", {
        apiKey: this.config.claudeApiKey,
        messages: mapMessages(messages),
        model: this.config.claudeModel ?? "claude-sonnet-4-20250514",
        system: systemPrompt,
        tools: convertTools(tools),
        onChunk,
        onStatus,
      });
    }, signal);
  }

  private async *chatClaudeCli(
    messages: Message[],
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const message = lastUserMessage?.content ?? "";

    const chunkQueue: string[] = [];
    let resolveChunk: (() => void) | null = null;
    let done = false;

    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk: string) => {
      if (signal?.aborted) return;
      chunkQueue.push(chunk);
      resolveChunk?.();
    };

    const onStatus = new Channel<string>();
    onStatus.onmessage = () => {};

    const invokePromise = invoke<string | null>("stream_claude_cli", {
      sessionId: this.config.sessionId ?? null,
      message,
      system: systemPrompt,
      model: this.config.claudeModel ?? null,
      effort: "medium",
      thinking: false,
      onChunk,
      onStatus,
    }).then((sessionId) => {
      done = true;
      resolveChunk?.();
      if (sessionId) {
        this.config.onSessionId?.(sessionId);
      }
    });

    while (!done || chunkQueue.length > 0) {
      if (signal?.aborted) {
        await invoke("cancel_ai_stream").catch(() => {});
        break;
      }

      if (chunkQueue.length > 0) {
        const chunk = chunkQueue.shift()!;
        yield { type: "text_delta", text: chunk };
      } else if (!done) {
        await new Promise<void>((resolve) => {
          resolveChunk = resolve;
        });
      }
    }

    await invokePromise.catch(() => {});
    yield { type: "done" };
  }
}
