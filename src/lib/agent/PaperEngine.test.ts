import { describe, expect, it, vi } from "vitest";
import { PaperEngine } from "./PaperEngine";
import type { LLMProvider, LLMStreamEvent, PaperState } from "./types";

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
