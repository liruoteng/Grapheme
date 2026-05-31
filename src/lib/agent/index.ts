export { QueryEngine } from "./QueryEngine";
export type { QueryEngineConfig, QueryResult, QueryEvent } from "./QueryEngine";

export { PaperEngine } from "./PaperEngine";
export type { PaperEngineConfig } from "./PaperEngine";

export { GraphemeLLMProvider } from "./GraphemeLLMProvider";
export type { GraphemeProviderConfig, AiProvider } from "./GraphemeLLMProvider";

export { buildTool } from "./buildTool";

export {
  getAllTools,
  getToolByName,
  getToolsForPhase,
  getToolPromptSummary,
} from "./tools";

export {
  getCoordinatorSystemPrompt,
  getPhasePrompt,
  buildUserPrompt,
  getToolsForCurrentPhase,
} from "./coordinator";
export type { CoordinatorConfig } from "./coordinator";

export type {
  Tool,
  Tools,
  ToolResult,
  ToolCall,
  ToolUseContext,
  Message,
  MessageRole,
  LLMProvider,
  LLMStreamEvent,
  JsonSchema,
  PaperState,
  PaperPhase,
  PaperSection,
  Citation,
  OutlineNode,
  RevisionEntry,
} from "./types";
