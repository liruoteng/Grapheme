import { QueryEngine, type QueryEvent, type QueryResult } from "./QueryEngine";
import {
  getCoordinatorSystemPrompt,
  getPhasePrompt,
  buildUserPrompt,
  getToolsForCurrentPhase,
} from "./coordinator";
import type { LLMProvider, PaperState } from "./types";

export interface PaperEngineConfig {
  provider: LLMProvider;
  paper: PaperState;
  customInstructions?: string;
}

export class PaperEngine {
  private queryEngine: QueryEngine;
  private paper: PaperState;

  constructor(config: PaperEngineConfig) {
    this.paper = config.paper;

    const systemPrompt = buildSystemPrompt(config);
    const tools = getToolsForCurrentPhase(config.paper.phase);

    this.queryEngine = new QueryEngine({
      provider: config.provider,
      tools,
      systemPrompt,
      maxTurns: 30,
    });
  }

  async *chat(userMessage: string): AsyncGenerator<QueryEvent, QueryResult> {
    const enrichedPrompt = buildUserPrompt(userMessage, this.paper);
    return yield* this.queryEngine.submitMessage(enrichedPrompt);
  }

  async *runPhaseInstruction(): AsyncGenerator<QueryEvent, QueryResult> {
    const instruction = getPhasePrompt(this.paper.phase);
    return yield* this.queryEngine.submitMessage(instruction);
  }

  updatePaper(paper: PaperState): void {
    this.paper = paper;
  }

  interrupt(): void {
    this.queryEngine.interrupt();
  }

  getMessages() {
    return this.queryEngine.getMessages();
  }

  clearHistory(): void {
    this.queryEngine.clearMessages();
  }
}

function buildSystemPrompt(config: PaperEngineConfig): string {
  const basePrompt = getCoordinatorSystemPrompt({
    paper: config.paper,
    customInstructions: config.customInstructions,
  });

  const phaseGuidance = getPhasePrompt(config.paper.phase);

  return `${basePrompt}\n\n## Current Phase Guidance\n\n${phaseGuidance}`;
}
