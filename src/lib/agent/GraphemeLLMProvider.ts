import { invoke, Channel } from "@tauri-apps/api/core";
import type { LLMProvider, LLMStreamEvent, Message, Tools, JsonSchema } from "./types";
import { DEFAULT_OLLAMA_URL } from "../constants";

export type AiProvider = "claude-cli" | "codex-cli" | "ollama";

export interface GraphemeProviderConfig {
  provider: AiProvider;
  claudeModel?: string;
  codexModel?: string;
  effort?: string;
  claudeApiKey?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  sessionId?: string | null;
  cwd?: string;
  onSessionId?: (id: string) => void;
}

interface BackendToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

function convertTools(tools: Tools): BackendToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function mapMessages(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    ...(m.name ? { name: m.name } : {}),
  }));
}

/** Tauri channels preserve message boundaries; text is never parsed as a tool call. */
function readNativeEvent(value: unknown): LLMStreamEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid AI stream event.");
  const event = value as Record<string, unknown>;
  if (event.type === "text_delta" && typeof event.text === "string") {
    return { type: "text_delta", text: event.text };
  }
  if (event.type === "tool_call" && event.toolCall && typeof event.toolCall === "object") {
    const call = event.toolCall as Record<string, unknown>;
    if (typeof call.id === "string" && call.id && typeof call.name === "string" && call.name
      && call.input && typeof call.input === "object" && !Array.isArray(call.input)) {
      return { type: "tool_call", toolCall: { id: call.id, name: call.name, input: call.input as Record<string, unknown> } };
    }
    throw new Error("The AI provider returned an invalid tool call.");
  }
  throw new Error("Invalid AI stream event.");
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
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    if (this.config.provider === "ollama") {
      yield* this.chatOllama(messages, tools, systemPrompt, signal);
    } else if (this.config.provider === "codex-cli") {
      yield* this.chatCodexCli(messages, systemPrompt, signal);
    } else if (this.config.claudeApiKey) {
      yield* this.chatClaudeApi(messages, tools, systemPrompt, signal);
    } else {
      yield* this.chatClaudeCli(messages, systemPrompt, signal);
    }
  }

  private async *streamResponse(
    invokeFn: (onChunk: Channel<unknown>) => Promise<void>,
    signal?: AbortSignal,
    structuredEvents = false
  ): AsyncGenerator<LLMStreamEvent> {
    signal?.throwIfAborted();
    let eventQueue: LLMStreamEvent[] = [];
    let queueIndex = 0;
    let wake: (() => void) | undefined;
    let done = false;
    let failure: Error | undefined;
    let closed = false;
    let cancelRequested = false;
    const cancel = () => {
      if (!done && !cancelRequested) {
        cancelRequested = true;
        void invoke("cancel_ai_stream").catch(() => {});
      }
      wake?.();
    };
    signal?.addEventListener("abort", cancel, { once: true });

    const onChunk = new Channel<unknown>();
    onChunk.onmessage = (chunk: unknown) => {
      if (closed || signal?.aborted || failure) return;
      try {
        if (structuredEvents) eventQueue.push(readNativeEvent(chunk));
        else if (typeof chunk === "string") eventQueue.push({ type: "text_delta", text: chunk });
        else throw new Error("Invalid AI text stream event.");
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        cancel();
      }
      wake?.();
    };

    // Always settle the consumer's waiter, including when Tauri rejects before
    // the first chunk. Keep a rejection handler attached after cancellation.
    try {
      void invokeFn(onChunk).then(
        () => {
          done = true;
          wake?.();
        },
        (error: unknown) => {
          failure = error instanceof Error ? error : new Error(String(error));
          done = true;
          wake?.();
        }
      );
      while (true) {
        signal?.throwIfAborted();
        if (failure) throw failure;
        if (queueIndex < eventQueue.length) {
          yield eventQueue[queueIndex++];
        } else {
          eventQueue = [];
          queueIndex = 0;
          if (done) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      }

      signal?.throwIfAborted();
      yield { type: "done" };
    } finally {
      closed = true;
      signal?.removeEventListener("abort", cancel);
      cancel();
    }
  }

  private chatOllama(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    return this.streamResponse(
      async (onChunk) => {
        await invoke("stream_ai_chat_with_tools", {
          messages: mapMessages(messages),
          ollamaUrl: this.config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
          ollamaModel: this.config.ollamaModel ?? "llama3",
          system: systemPrompt,
          tools: convertTools(tools),
          onChunk,
        });
      },
      signal,
      true
    );
  }

  private chatClaudeApi(
    messages: Message[],
    tools: Tools,
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    return this.streamResponse(
      async (onChunk) => {
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
      },
      signal,
      true
    );
  }

  private chatClaudeCli(
    messages: Message[],
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    return this.streamResponse(async (onChunk) => {
      const onStatus = new Channel<string>();
      onStatus.onmessage = () => {};
      const sessionId = await invoke<string | null>("stream_claude_cli", {
        sessionId: this.config.sessionId ?? null,
        message: lastUserMessage?.content ?? "",
        system: systemPrompt,
        model: this.config.claudeModel ?? null,
        effort: this.config.effort ?? "medium",
        thinking: false,
        onChunk,
        onStatus,
      });
      if (sessionId && !signal?.aborted) {
        this.config.sessionId = sessionId;
        this.config.onSessionId?.(sessionId);
      }
    }, signal);
  }

  private chatCodexCli(
    messages: Message[],
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const runtimeSystemPrompt = [
      systemPrompt,
      "Grapheme runtime metadata (trusted app configuration):",
      `- requested Codex model ID: ${this.config.codexModel ?? "configured default"}`,
      `- reasoning effort: ${this.config.effort ?? "medium"}`,
      "When asked about the configured runtime, report these values. Do not claim that they reveal a hidden deployment build or internal model identity.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return this.streamResponse(async (onChunk) => {
      const onStatus = new Channel<string>();
      onStatus.onmessage = () => {};
      const sessionId = await invoke<string | null>("stream_codex_cli", {
        sessionId: this.config.sessionId ?? null,
        message: lastUserMessage?.content ?? "",
        system: runtimeSystemPrompt,
        model: this.config.codexModel ?? null,
        effort: this.config.effort ?? "medium",
        cwd: this.config.cwd ?? null,
        onChunk,
        onStatus,
      });
      if (sessionId && !signal?.aborted) {
        this.config.sessionId = sessionId;
        this.config.onSessionId?.(sessionId);
      }
    }, signal);
  }
}
