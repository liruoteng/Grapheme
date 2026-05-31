import { invoke, Channel } from "@tauri-apps/api/core";
import type { LLMProvider, LLMStreamEvent, Message, Tools, ToolCall } from "./types";

export type AiProvider = "claude-cli" | "ollama";

export interface GraphemeProviderConfig {
  provider: AiProvider;
  claudeModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  sessionId?: string | null;
  onSessionId?: (id: string) => void;
}

function parseToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const regex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const inputStr = match[2].trim();
    try {
      const input = JSON.parse(inputStr);
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        input,
      });
    } catch {
      console.warn(`Failed to parse tool call input for ${name}:`, inputStr);
    }
  }

  return toolCalls;
}

function getExampleInput(tool: { inputSchema: { properties?: Record<string, unknown>; required?: string[] } }): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  const props = tool.inputSchema.properties ?? {};
  const required = tool.inputSchema.required ?? [];

  for (const key of required) {
    const schema = props[key] as { type?: string; description?: string } | undefined;
    if (!schema) continue;
    switch (schema.type) {
      case "string":
        example[key] = `example_${key}`;
        break;
      case "number":
        example[key] = 10;
        break;
      case "boolean":
        example[key] = true;
        break;
      case "array":
        example[key] = [];
        break;
      default:
        example[key] = null;
    }
  }
  return example;
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
    const toolDescriptions = this.formatToolsForPrompt(tools);
    const enhancedSystemPrompt = `${systemPrompt}\n\n${toolDescriptions}`;

    if (this.config.provider === "ollama") {
      yield* this.chatOllama(messages, enhancedSystemPrompt, signal);
    } else {
      yield* this.chatClaudeCli(messages, enhancedSystemPrompt, signal);
    }
  }

  private async *chatOllama(
    messages: Message[],
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    const apiMessages = messages.map((m) => ({
      role: m.role === "tool" ? "assistant" : m.role,
      content: m.role === "tool" ? `Tool result: ${m.content}` : m.content,
    }));

    let fullText = "";
    const chunkQueue: string[] = [];
    let resolveChunk: (() => void) | null = null;
    let done = false;

    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk: string) => {
      if (signal?.aborted) return;
      fullText += chunk;
      chunkQueue.push(chunk);
      resolveChunk?.();
    };

    const invokePromise = invoke("stream_ai_chat", {
      messages: apiMessages,
      ollamaUrl: this.config.ollamaUrl ?? "http://localhost:11434",
      ollamaModel: this.config.ollamaModel ?? "llama3",
      system: systemPrompt,
      onChunk,
    }).then(() => {
      done = true;
      resolveChunk?.();
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

    const toolCalls = parseToolCalls(fullText);
    for (const call of toolCalls) {
      yield { type: "tool_call", toolCall: call };
    }

    yield { type: "done" };
  }

  private async *chatClaudeCli(
    messages: Message[],
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const message = lastUserMessage?.content ?? "";

    let fullText = "";
    const chunkQueue: string[] = [];
    let resolveChunk: (() => void) | null = null;
    let done = false;

    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk: string) => {
      if (signal?.aborted) return;
      fullText += chunk;
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

    const toolCalls = parseToolCalls(fullText);
    for (const call of toolCalls) {
      yield { type: "tool_call", toolCall: call };
    }

    yield { type: "done" };
  }

  private formatToolsForPrompt(tools: Tools): string {
    if (tools.length === 0) return "";

    const toolDocs = tools.map((tool) => {
      const params = Object.entries(tool.inputSchema.properties ?? {})
        .map(([key, schema]) => {
          const required = tool.inputSchema.required?.includes(key) ? " (required)" : "";
          const desc = (schema as { description?: string }).description ?? "";
          return `    - ${key}${required}: ${desc}`;
        })
        .join("\n");

      const example = getExampleInput(tool);

      return `### ${tool.name}
${tool.description}

Parameters:
${params || "    (none)"}

Example usage:
<tool_call name="${tool.name}">
${JSON.stringify(example, null, 2)}

`;
    }).join("\n\n");

    return `# Available Tools

You have access to the following tools:

${toolDocs}

When you need to use a tool, respond with the tool call in the format shown in the examples above.
`;
  }
}