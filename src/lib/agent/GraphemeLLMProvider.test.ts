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
      }),
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
      }),
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
      }),
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

  it("maps tool role messages to assistant", async () => {
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
          { role: "assistant", content: "Tool result: result data" },
        ],
      }),
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
      }),
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
      }),
    );
  });
});
