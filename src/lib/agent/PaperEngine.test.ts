import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperEngine } from "./PaperEngine";
import { clearAllToolState } from "./tools";
import { getSectionStore } from "./tools/SectionDraftTool";
import type { LLMProvider, LLMStreamEvent, PaperState } from "./types";

afterEach(clearAllToolState);

function makePaper(overrides: Partial<PaperState> = {}): PaperState {
  return {
    id: "p1",
    title: "Test Paper",
    abstract: "",
    sections: [],
    citations: [],
    outline: [],
    phase: "drafting",
    citationStyle: "apa",
    revisionLog: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeProvider(text = "AI response"): LLMProvider {
  return {
    async *chat(): AsyncGenerator<LLMStreamEvent> {
      yield { type: "text_delta", text };
      yield { type: "done" };
    },
  };
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown> {
  let result;
  for (;;) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
  }
  return result;
}

describe("PaperEngine", () => {
  it("refreshes instructions and available tools when the phase changes", async () => {
    const calls: { prompt: string; tools: string[] }[] = [];
    const provider: LLMProvider = {
      async *chat(_messages, tools, prompt) {
        calls.push({ prompt, tools: tools.map((tool) => tool.name) });
        yield { type: "text_delta", text: "ok" };
      },
    };
    const engine = new PaperEngine({ provider, paper: makePaper({ phase: "research" }) });
    await drain(engine.chat("Find evidence"));
    engine.updatePaper(makePaper({ phase: "polishing", title: "Updated title" }));
    await drain(engine.chat("Polish"));
    expect(calls[0].tools).toContain("LiteratureSearch");
    expect(calls[1].tools).toEqual(["SectionDraft"]);
    expect(calls[1].prompt).toContain("Updated title");
    expect(calls[1].prompt).toContain("**Phase**: polishing");
  });

  it("requires write approval and never lets the reviewer mutate a paper", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      async *chat() {
        if (calls++ % 2 === 0) yield {
          type: "tool_call",
          toolCall: { id: "call", name: "SectionDraft", input: { action: "create", sectionId: "intro", title: "Introduction" } },
        };
        else yield { type: "text_delta", text: "done" };
      },
    };
    const approve = vi.fn().mockResolvedValue(true);
    const engine = new PaperEngine({ provider, paper: makePaper(), requestPermission: approve });
    await drain(engine.chat("Draft intro"));
    expect(approve).toHaveBeenCalledOnce();
    expect(getSectionStore("p1").has("intro")).toBe(true);
    engine.updatePaper(makePaper({ id: "p2", phase: "reviewing" }));
    expect(engine.getMessages()).toEqual([]);
    await drain(engine.chat("Review"));
    expect(approve).toHaveBeenCalledOnce();
    expect(getSectionStore("p2").size).toBe(0);
    expect(engine.getMessages().find((message) => message.role === "tool")?.content).toContain("not allowed");
  });

  it("does not append old tool results after switching papers mid-response", async () => {
    const provider: LLMProvider = {
      async *chat() {
        yield { type: "tool_call", toolCall: { id: "call", name: "SectionDraft", input: { action: "list" } } };
      },
    };
    const engine = new PaperEngine({ provider, paper: makePaper() });
    const response = engine.chat("List sections");
    let event = await response.next();
    while (!event.done && event.value.type !== "tool_call_result") event = await response.next();
    expect(event.done).toBe(false);
    engine.updatePaper(makePaper({ id: "p2" }));
    await expect(response.next()).rejects.toThrow();
    expect(engine.getMessages()).toEqual([]);
  });

  it("creates without error", () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
    });
    expect(engine).toBeDefined();
  });

  it("chat yields events and returns a result", async () => {
    const engine = new PaperEngine({
      provider: makeProvider("Hello from engine"),
      paper: makePaper(),
    });

    const gen = engine.chat("Write something");
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

    expect(events.length).toBeGreaterThan(0);
    expect(result).toBeDefined();
    expect(result.stopReason).toBe("end_turn");
  });

  it("runPhaseInstruction uses the phase prompt", async () => {
    const engine = new PaperEngine({
      provider: makeProvider("Phase done"),
      paper: makePaper({ phase: "research" }),
    });

    const result = await drain(engine.runPhaseInstruction());
    expect(result).toBeDefined();
    expect((result as { stopReason: string }).stopReason).toBe("end_turn");
  });

  it("getMessages returns messages after chat", async () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
    });

    await drain(engine.chat("Hello"));
    const msgs = engine.getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("clearHistory resets messages", async () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
    });

    await drain(engine.chat("Hello"));
    expect(engine.getMessages().length).toBeGreaterThan(0);

    engine.clearHistory();
    expect(engine.getMessages()).toHaveLength(0);
  });

  it("updatePaper does not throw", () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
    });
    expect(() => engine.updatePaper(makePaper({ title: "New Title" }))).not.toThrow();
  });

  it("interrupt does not throw", () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
    });
    expect(() => engine.interrupt()).not.toThrow();
  });

  it("accepts custom instructions", () => {
    const engine = new PaperEngine({
      provider: makeProvider(),
      paper: makePaper(),
      customInstructions: "Be brief.",
    });
    expect(engine).toBeDefined();
  });

  it("enriches user prompt with outline context", async () => {
    const chatSpy = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "ok" };
      yield { type: "done" };
    });

    const provider: LLMProvider = {
      chat: chatSpy,
    };

    const paper = makePaper({
      outline: [
        { id: "o1", title: "Introduction", level: 1, children: [] },
      ],
    });

    const engine = new PaperEngine({ provider, paper });
    await drain(engine.chat("Write intro"));

    const firstArg = chatSpy.mock.calls[0][0];
    const userMsg = firstArg.find((m: { role: string }) => m.role === "user");
    expect(userMsg.content).toContain("Introduction");
    expect(userMsg.content).toContain("User request: Write intro");
  });
});
