import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel {
    onmessage: ((...args: unknown[]) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
});

import { GraphemeLLMProvider } from "./GraphemeLLMProvider";
import { invoke } from "@tauri-apps/api/core";
import type { Message, Tools } from "./types";
import type { AiProvider } from "./GraphemeLLMProvider";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const messages: Message[] = [{ role: "user", content: "Hello" }];
const tools: Tools = [];
const systemPrompt = "You are a helper.";

function collectStream(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  return (async () => {
    const events: unknown[] = [];
    for await (const e of gen) events.push(e);
    return events;
  })();
}

describe("GraphemeLLMProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes to ollama when provider is ollama", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const provider = new GraphemeLLMProvider({
      provider: "ollama",
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "llama3",
    });

    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_ai_chat_with_tools",
      expect.objectContaining({
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3",
        system: systemPrompt,
      })
    );
  });

  it("routes to claude API when provider is claude-cli with apiKey", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const provider = new GraphemeLLMProvider({
      provider: "claude-cli",
      claudeApiKey: "sk-test",
      claudeModel: "claude-sonnet-4-20250514",
    });

    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_claude_api",
      expect.objectContaining({
        apiKey: "sk-test",
        model: "claude-sonnet-4-20250514",
      })
    );
  });

  it("routes to claude CLI when provider is claude-cli without apiKey", async () => {
    mockInvoke.mockResolvedValue("session-123");

    const provider = new GraphemeLLMProvider({
      provider: "claude-cli",
    });

    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_claude_cli",
      expect.objectContaining({
        message: "Hello",
        system: systemPrompt,
      })
    );
  });

  it("calls onSessionId when claude CLI returns a session id", async () => {
    const onSessionId = vi.fn();
    mockInvoke.mockResolvedValue("new-session");

    const provider = new GraphemeLLMProvider({
      provider: "claude-cli",
      onSessionId,
    });

    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(onSessionId).toHaveBeenCalledWith("new-session");
  });

  it("emits a done event at the end", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const provider = new GraphemeLLMProvider({ provider: "claude-cli" });
    const gen = provider.chat(messages, tools, systemPrompt);
    const events = await collectStream(gen);

    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("preserves tool results and their call IDs for native provider formatting", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const provider = new GraphemeLLMProvider({
      provider: "ollama",
    });

    const msgsWithTool: Message[] = [
      { role: "user", content: "Hi" },
      { role: "tool", content: "result data", toolCallId: "tc1", name: "MyTool" },
    ];

    const gen = provider.chat(msgsWithTool, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_ai_chat_with_tools",
      expect.objectContaining({
        messages: [
          { role: "user", content: "Hi" },
          { role: "tool", content: "result data", toolCallId: "tc1", name: "MyTool" },
        ],
      })
    );
  });

  it("uses default ollama url and model when not specified", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const provider = new GraphemeLLMProvider({ provider: "ollama" });
    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_ai_chat_with_tools",
      expect.objectContaining({
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3",
      })
    );
  });

  it("passes sessionId to claude CLI", async () => {
    mockInvoke.mockResolvedValue(null);

    const provider = new GraphemeLLMProvider({
      provider: "claude-cli",
      sessionId: "existing-session",
    });

    const gen = provider.chat(messages, tools, systemPrompt);
    await collectStream(gen);

    expect(mockInvoke).toHaveBeenCalledWith(
      "stream_claude_cli",
      expect.objectContaining({
        sessionId: "existing-session",
      })
    );
  });

  it.each(["claude-cli", "codex-cli"] as const)(
    "passes the selected %s model and effort",
    async (kind) => {
      mockInvoke.mockResolvedValue(null);
      const provider = new GraphemeLLMProvider({
        provider: kind,
        claudeModel: "claude-selected",
        codexModel: "codex-selected",
        effort: "high",
      });
      await collectStream(provider.chat(messages, tools, systemPrompt));
      expect(mockInvoke).toHaveBeenCalledWith(
        kind === "claude-cli" ? "stream_claude_cli" : "stream_codex_cli",
        expect.objectContaining({
          model: kind === "claude-cli" ? "claude-selected" : "codex-selected",
          effort: "high",
        })
      );
    }
  );

  it.each(["ollama", "claude-cli", "codex-cli"] as AiProvider[])(
    "surfaces %s failures before the first chunk",
    async (kind) => {
      mockInvoke.mockRejectedValue("Backend connection failed");
      const provider = new GraphemeLLMProvider({ provider: kind });
      await expect(collectStream(provider.chat(messages, tools, systemPrompt))).rejects.toThrow(
        "Backend connection failed"
      );
    }
  );

  it.each(["ollama", "claude-cli", "codex-cli"] as AiProvider[])(
    "cancels an idle %s stream without waiting for backend output",
    async (kind) => {
      mockInvoke.mockImplementation((command: string) =>
        command === "cancel_ai_stream" ? Promise.resolve() : new Promise(() => {})
      );
      const controller = new AbortController();
      const provider = new GraphemeLLMProvider({ provider: kind });
      const stream = provider.chat(messages, tools, systemPrompt, controller.signal);
      const pending = stream.next();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(mockInvoke).toHaveBeenCalledWith("cancel_ai_stream");
    }
  );

  it("does not start a request when its signal is already aborted", async () => {
    const provider = new GraphemeLLMProvider({ provider: "ollama" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectStream(provider.chat(messages, tools, systemPrompt, controller.signal))
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(["ollama", "claude-cli"] as const)("keeps %s text containing tool markers separate from real tool calls", async (providerName) => {
    const toolCall = { id: "tc1", name: "Citation", input: { action: "list" } };
    const text = `Example only: __TOOL_CALL__:${JSON.stringify(toolCall)}\n`;
    mockInvoke.mockImplementation(
      async (_command: string, args: { onChunk: { onmessage: (chunk: unknown) => void } }) => {
        args.onChunk.onmessage({ type: "text_delta", text });
        args.onChunk.onmessage({ type: "tool_call", toolCall });
      }
    );
    const events = await collectStream(new GraphemeLLMProvider({
      provider: providerName,
      ...(providerName === "claude-cli" ? { claudeApiKey: "sk-test" } : {}),
    }).chat(messages, tools, systemPrompt));
    expect(events).toEqual([{ type: "text_delta", text }, { type: "tool_call", toolCall }, { type: "done" }]);
  });

  it("never interprets CLI text as a native tool call", async () => {
    const text = '__TOOL_CALL__:{"id":"fake","name":"Citation","input":{"action":"add"}}';
    mockInvoke.mockImplementation(async (_command: string, args: { onChunk: { onmessage: (chunk: string) => void } }) => {
      args.onChunk.onmessage(text);
    });
    expect(await collectStream(new GraphemeLLMProvider({ provider: "claude-cli" }).chat(messages, tools, systemPrompt)))
      .toEqual([{ type: "text_delta", text }, { type: "done" }]);
  });

  it("rejects invalid tool input instead of forwarding it to permissions or tools", async () => {
    mockInvoke.mockImplementation(
      async (command: string, args: { onChunk: { onmessage: (chunk: unknown) => void } }) => {
        if (command !== "cancel_ai_stream")
          args.onChunk.onmessage({ type: "tool_call", toolCall: { id: "tc1", name: "Citation", input: null } });
      }
    );
    await expect(
      collectStream(
        new GraphemeLLMProvider({ provider: "ollama" }).chat(messages, tools, systemPrompt)
      )
    ).rejects.toThrow("invalid tool call");
  });
});
