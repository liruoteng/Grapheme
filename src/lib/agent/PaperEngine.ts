import { QueryEngine, type QueryEngineConfig, type QueryEvent, type QueryResult } from "./QueryEngine";
import { getAgentForWorkflow } from "./agents";
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
  requestPermission?: QueryEngineConfig["requestPermission"];
}

export class PaperEngine {
  private queryEngine: QueryEngine;
  private paper: PaperState;
  private config: PaperEngineConfig;

  constructor(config: PaperEngineConfig) {
    this.paper = config.paper;
    this.config = config;

    const systemPrompt = buildSystemPrompt(config);
    const tools = getToolsForCurrentPhase(config.paper.phase);

    this.queryEngine = new QueryEngine({
      provider: config.provider,
      tools,
      systemPrompt,
      maxTurns: 30,
      context: { paperId: config.paper.id },
      agent: agentForPaper(config.paper),
      requestPermission: config.requestPermission,
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
    this.queryEngine.interrupt();
    if (this.paper.id !== paper.id) this.queryEngine.clearMessages();
    this.paper = paper;
    this.config = { ...this.config, paper };
    this.queryEngine.updateConfig({
      tools: getToolsForCurrentPhase(paper.phase),
      systemPrompt: buildSystemPrompt(this.config),
      context: { paperId: paper.id },
      agent: agentForPaper(paper),
    });
  }

  interrupt(): void {
    this.queryEngine.interrupt();
  }

  getMessages() {
    return this.queryEngine.getMessages();
  }

  clearHistory(): void {
    this.queryEngine.interrupt();
    this.queryEngine.clearMessages();
  }
}

function agentForPaper(paper: PaperState) {
  return getAgentForWorkflow(paper.phase === "reviewing" ? "review" : paper.phase === "research" ? "research" : "general");
}

function buildSystemPrompt(config: PaperEngineConfig): string {
  const basePrompt = getCoordinatorSystemPrompt({
    paper: config.paper,
    customInstructions: config.customInstructions,
  });

  const phaseGuidance = getPhasePrompt(config.paper.phase);

  return `${basePrompt}\n\n## Current Phase Guidance\n\n${phaseGuidance}`;
}
