import { describe, expect, it, vi } from "vitest";
import { QueryEngine } from "./QueryEngine";
import type { LLMProvider, LLMStreamEvent, Tools } from "./types";

vi.mock("./tools", () => ({
  getToolByName: (name: string) => {
    if (name === "KnownTool") {
      return {
        name: "KnownTool",
        call: async (input: Record<string, unknown>) => ({ data: { result: "ok", ...input } }),
      };
    }
    return undefined;
  },
}));

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

describe("QueryEngine", () => {
  it("returns text from a simple response", async () => {
    const provider = makeProvider([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "done" },
    ]);

    const engine = new QueryEngine({
      provider,
      tools: emptyTools,
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

    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });
    const gen = engine.submitMessage("Hi");
    const events: unknown[] = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      events.push(next.value);
    }

    const textEvents = events.filter(
      (e: unknown) => (e as { type: string }).type === "text_delta",
    );
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
      [
        { type: "text_delta", text: "Done." },
        { type: "done" },
      ],
    ]);

    const engine = new QueryEngine({ provider, tools: emptyTools, systemPrompt: "test" });
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
      (e: unknown) => (e as { type: string }).type === "tool_call_start",
    );
    expect(toolStarts).toHaveLength(1);

    const toolResults = events.filter(
      (e: unknown) => (e as { type: string }).type === "tool_call_result",
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
      (e: unknown) => (e as { type: string }).type === "tool_call_result",
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

    const provider = makeMultiTurnProvider(
      Array.from({ length: 5 }, () => alwaysToolCall),
    );

    const engine = new QueryEngine({
      provider,
      tools: emptyTools,
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
      tools: emptyTools,
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
      (e: unknown) => (e as { type: string }).type === "tool_call_result",
    ) as { toolResult: unknown };
    expect(toolResult.toolResult).toEqual({ error: "Unknown tool: NonexistentTool" });
    expect(result.stopReason).toBe("end_turn");
  });
});
