import { describe, expect, it, vi } from "vitest";
import { QueryEngine } from "./QueryEngine";
import type { LLMProvider, LLMStreamEvent, Tools } from "./types";
import { getAgent } from "./agents";

const knownTool = {
  name: "KnownTool",
  isReadOnly: () => false,
  call: async (input: Record<string, unknown>) => ({ data: { result: "ok", ...input } }),
  description: "Known test tool",
  inputSchema: { type: "object" },
  prompt: () => "Known test tool",
};

function makeProvider(events: LLMStreamEvent[]): LLMProvider {
  return {
    async *chat(): AsyncGenerator<LLMStreamEvent> {
      for (const e of events) yield e;
    },
  };
}

function makeMultiTurnProvider(eventSets: LLMStreamEvent[][]): LLMProvider {
  let callIndex = 0;
  return {
    async *chat(): AsyncGenerator<LLMStreamEvent> {
      const events = eventSets[callIndex++] ?? [];
      for (const e of events) yield e;
    },
  };
}

const emptyTools: Tools = [];
const knownTools: Tools = [knownTool];

describe("QueryEngine", () => {
  it("returns text from a simple response", async () => {
    const provider = makeProvider([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "done" },
    ]);

    const engine = new QueryEngine({
      provider,
      tools: knownTools,
      systemPrompt: "test",
    });

    const gen = engine.submitMessage("Hi");
    const events: unknown[] = [];
    let result;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }

    expect(result.text).toBe("Hello world");
    expect(result.stopReason).toBe("end_turn");
    expect(result.turnsUsed).toBe(1);
    expect(result.toolCallsMade).toBe(0);
  });

  it("yields text_delta events during streaming", async () => {
    const provider = makeProvider([
      { type: "text_delta", text: "A" },
      { type: "text_delta", text: "B" },
      { type: "done" },
    ]);

    const engine = new QueryEngine({ provider, tools: knownTools, systemPrompt: "test" });
    const gen = engine.submitMessage("Hi");
    const events: unknown[] = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      events.push(next.value);
    }

    const textEvents = events.filter((e: unknown) => (e as { type: string }).type === "text_delta");
    expect(textEvents).toHaveLength(2);
  });

  it("executes tool calls and continues the conversation", async () => {
    const provider = makeMultiTurnProvider([
      [
        { type: "text_delta", text: "Let me check." },
        {
          type: "tool_call",
          toolCall: { id: "tc1", name: "KnownTool", input: { key: "val" } },
        },
        { type: "done" },
      ],
      [{ type: "text_delta", text: "Done." }, { type: "done" }],
    ]);

    const engine = new QueryEngine({ provider, tools: knownTools, systemPrompt: "test" });
    const gen = engine.submitMessage("Use a tool");
    const events: unknown[] = [];
    let result;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }

    expect(result.toolCallsMade).toBe(1);
    expect(result.turnsUsed).toBe(2);
    expect(result.stopReason).toBe("end_turn");

    const toolStarts = events.filter(
      (e: unknown) => (e as { type: string }).type === "tool_call_start"
    );
    expect(toolStarts).toHaveLength(1);

    const toolResults = events.filter(
      (e: unknown) => (e as { type: string }).type === "tool_call_result"
    );
    expect(toolResults).toHaveLength(1);
  });

  it("returns an error for unknown tools", async () => {
    const provider = makeMultiTurnProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "tc1", name: "UnknownTool", input: {} },
        },
        { type: "done" },
      ],
      [{ type: "text_delta", text: "ok" }, { type: "done" }],
    ]);

    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });
    const gen = engine.submitMessage("Use unknown");
    const events: unknown[] = [];
    let result;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }

    const toolResultEvent = events.find(
      (e: unknown) => (e as { type: string }).type === "tool_call_result"
    ) as { toolResult: unknown };
    expect(toolResultEvent.toolResult).toEqual({ error: "Unknown tool: UnknownTool" });
    expect(result.stopReason).toBe("end_turn");
  });

  it("stops at maxTurns", async () => {
    const alwaysToolCall: LLMStreamEvent[] = [
      {
        type: "tool_call",
        toolCall: { id: "tc1", name: "KnownTool", input: {} },
      },
      { type: "done" },
    ];

    const provider = makeMultiTurnProvider(Array.from({ length: 5 }, () => alwaysToolCall));

    const engine = new QueryEngine({
      provider,
      tools: knownTools,
      systemPrompt: "test",
      maxTurns: 3,
    });

    const gen = engine.submitMessage("loop");
    let result;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.stopReason).toBe("max_turns");
    expect(result.turnsUsed).toBe(3);
  });

  it("tracks messages across turns", async () => {
    const provider = makeMultiTurnProvider([
      [{ type: "text_delta", text: "Reply" }, { type: "done" }],
    ]);

    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });
    const gen = engine.submitMessage("Hello");
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
    }

    const msgs = engine.getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("clearMessages resets history", async () => {
    const provider = makeProvider([{ type: "text_delta", text: "x" }, { type: "done" }]);
    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });

    const gen = engine.submitMessage("Hi");
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
    }

    expect(engine.getMessages().length).toBeGreaterThan(0);
    engine.clearMessages();
    expect(engine.getMessages()).toHaveLength(0);
  });

  it("interrupt aborts the stream", () => {
    const provider = makeProvider([{ type: "done" }]);
    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });
    expect(() => engine.interrupt()).not.toThrow();
  });

  it("handles tool execution errors gracefully", async () => {
    const errorProvider = makeMultiTurnProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "tc1", name: "NonexistentTool", input: {} },
        },
        { type: "done" },
      ],
      [{ type: "text_delta", text: "recovered" }, { type: "done" }],
    ]);

    const engine = new QueryEngine({
      provider: errorProvider,
      tools: knownTools,
      systemPrompt: "test",
    });
    const gen = engine.submitMessage("go");
    const events: unknown[] = [];
    let result;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }

    const toolResult = events.find(
      (e: unknown) => (e as { type: string }).type === "tool_call_result"
    ) as { toolResult: unknown };
    expect(toolResult.toolResult).toEqual({ error: "Unknown tool: NonexistentTool" });
    expect(result.stopReason).toBe("end_turn");
  });

  it("denies write tools for a read-only agent", async () => {
    const provider = makeProvider([
      { type: "tool_call", toolCall: { id: "tc1", name: "KnownTool", input: {} } },
      { type: "done" },
    ]);
    const engine = new QueryEngine({
      provider,
      tools: knownTools,
      systemPrompt: "test",
      agent: {
        name: "reviewer",
        description: "read only",
        mode: "subagent",
        prompt: "",
        permissions: [{ permission: "write", pattern: "*", action: "deny" }],
      },
    });
    const events: unknown[] = [];
    const gen = engine.submitMessage("review");
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(events.some((event) => JSON.stringify(event).includes("not allowed"))).toBe(true);
  });

  it("asks for permission before an agent uses a write tool", async () => {
    const provider = makeProvider([
      { type: "tool_call", toolCall: { id: "tc1", name: "KnownTool", input: {} } },
      { type: "done" },
    ]);
    const requestPermission = vi.fn().mockResolvedValue(true);
    const engine = new QueryEngine({
      provider,
      tools: knownTools,
      systemPrompt: "test",
      requestPermission,
      agent: {
        name: "writing",
        description: "writing",
        mode: "primary",
        prompt: "",
        permissions: [{ permission: "write", pattern: "*", action: "ask" }],
      },
    });
    const gen = engine.submitMessage("edit");
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
    }
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "writing",
        permission: "write",
        toolName: "KnownTool",
      })
    );
  });

  it("stops waiting for approval on cancellation and never executes a late approval", async () => {
    let approve!: (value: boolean) => void;
    const requestPermission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        })
    );
    const call = vi.fn().mockResolvedValue({ data: "changed" });
    const engine = new QueryEngine({
      provider: makeProvider([
        { type: "tool_call", toolCall: { id: "tc1", name: "KnownTool", input: {} } },
      ]),
      tools: [{ ...knownTool, call }],
      systemPrompt: "test",
      agent: getAgent("writing"),
      requestPermission,
    });
    const stream = engine.submitMessage("Edit");
    while (true) {
      const next = await stream.next();
      if (next.done) throw new Error("Expected a permission request before completion");
      if (next.value.type === "permission_request") break;
    }
    const pending = stream.next();
    expect(requestPermission).toHaveBeenCalledOnce();
    engine.interrupt();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    approve(true);
    await Promise.resolve();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not execute queued tool calls after interruption", async () => {
    const call = vi.fn().mockResolvedValue({ data: "changed" });
    const engine = new QueryEngine({
      provider: makeProvider([
        { type: "tool_call", toolCall: { id: "tc1", name: "KnownTool", input: {} } },
      ]),
      tools: [{ ...knownTool, call }],
      systemPrompt: "test",
    });
    const stream = engine.submitMessage("Edit");
    expect((await stream.next()).value).toMatchObject({ type: "turn_complete" });
    engine.interrupt();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(call).not.toHaveBeenCalled();
  });

  it("passes its cancellation signal to active tools and skips subsequent calls", async () => {
    let toolSignal: AbortSignal | undefined;
    const call = vi.fn(async (_input, context) => {
      toolSignal = context.abortSignal;
      engine.interrupt();
      return { data: "done" };
    });
    const engine = new QueryEngine({
      provider: makeProvider([
        { type: "tool_call", toolCall: { id: "tc1", name: "KnownTool", input: {} } },
        { type: "tool_call", toolCall: { id: "tc2", name: "KnownTool", input: {} } },
      ]),
      tools: [{ ...knownTool, call }],
      systemPrompt: "test",
    });
    const run = async () => {
      for await (const _event of engine.submitMessage("Edit")) {
        expect(_event.type).toBeTruthy();
      }
    };
    await expect(run()).rejects.toMatchObject({ name: "AbortError" });
    expect(call).toHaveBeenCalledOnce();
    expect(toolSignal?.aborted).toBe(true);
  });

  it("prevents concurrent submissions from replacing the current cancellation controller", async () => {
    const engine = new QueryEngine({
      provider: makeProvider([{ type: "text_delta", text: "First" }]),
      tools: [],
      systemPrompt: "test",
    });
    const first = engine.submitMessage("First");
    await first.next();
    await expect(engine.submitMessage("Second").next()).rejects.toThrow("already running");
    engine.interrupt();
    await expect(first.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
  });
});
