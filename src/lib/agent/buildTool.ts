import type { JsonSchema, Tool, ToolResult, ToolUseContext } from "./types";

interface ToolDef<Input = Record<string, unknown>, Output = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call(input: Input, context: ToolUseContext): Promise<ToolResult<Output>>;
  isReadOnly?(input: Input): boolean;
  prompt?(): string;
}

export function buildTool<Input = Record<string, unknown>, Output = unknown>(
  def: ToolDef<Input, Output>,
): Tool<Input, Output> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    call: def.call,
    isReadOnly: def.isReadOnly ?? (() => false),
    prompt: def.prompt ?? (() => def.description),
  };
}
