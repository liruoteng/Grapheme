import { buildTool } from "../buildTool";
import type { OutlineNode } from "../types";

type OutlineAction = "set" | "add" | "remove" | "get";

interface OutlineInput {
  action: OutlineAction;
  nodes?: OutlineNode[];
  nodeId?: string;
  title?: string;
  level?: number;
  parentId?: string;
}

interface OutlineResult {
  action: OutlineAction;
  outline: OutlineNode[];
  message?: string;
}

let currentOutline: OutlineNode[] = [];

function generateId(): string {
  return `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findAndRemove(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: findAndRemove(n.children, id) }));
}

function addChild(
  nodes: OutlineNode[],
  parentId: string,
  child: OutlineNode,
): OutlineNode[] {
  return nodes.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] };
    }
    return { ...n, children: addChild(n.children, parentId, child) };
  });
}

export const OutlineTool = buildTool<OutlineInput, OutlineResult>({
  name: "Outline",
  description:
    "Manage paper outline structure. Actions: 'set' replaces entire outline, 'add' appends a node, 'remove' deletes a node, 'get' returns current outline.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["set", "add", "remove", "get"],
        description: "The action to perform",
      },
      nodes: {
        type: "array",
        description: "Outline nodes (for set action)",
      },
      nodeId: { type: "string", description: "Node ID (for remove)" },
      title: { type: "string", description: "Section title (for add)" },
      level: { type: "number", description: "Heading level 1-5 (for add)" },
      parentId: {
        type: "string",
        description: "Parent node ID for nesting (for add)",
      },
    },
    required: ["action"],
  },
  isReadOnly: (input) => input.action === "get",
  async call(input) {
    switch (input.action) {
      case "set": {
        currentOutline = input.nodes ?? [];
        return {
          data: {
            action: "set",
            outline: currentOutline,
            message: `Outline set with ${currentOutline.length} top-level sections`,
          },
        };
      }

      case "add": {
        if (!input.title) {
          return {
            data: { action: "add", outline: currentOutline },
            error: "title is required",
          };
        }
        const node: OutlineNode = {
          id: input.nodeId ?? generateId(),
          title: input.title,
          level: input.level ?? 1,
          children: [],
        };
        if (input.parentId) {
          currentOutline = addChild(currentOutline, input.parentId, node);
        } else {
          currentOutline = [...currentOutline, node];
        }
        return {
          data: {
            action: "add",
            outline: currentOutline,
            message: `Added: ${input.title}`,
          },
        };
      }

      case "remove": {
        if (!input.nodeId) {
          return {
            data: { action: "remove", outline: currentOutline },
            error: "nodeId is required",
          };
        }
        currentOutline = findAndRemove(currentOutline, input.nodeId);
        return {
          data: {
            action: "remove",
            outline: currentOutline,
            message: "Node removed",
          },
        };
      }

      case "get": {
        return { data: { action: "get", outline: currentOutline } };
      }
    }
  },
  prompt() {
    return `Use Outline to structure the paper. Start with top-level sections (Introduction, Methods, Results, Discussion, Conclusion), then add subsections. The outline drives the drafting workflow.`;
  },
});

export function getOutline(): OutlineNode[] {
  return currentOutline;
}

export function setOutline(outline: OutlineNode[]): void {
  currentOutline = outline;
}

export function clearOutline(): void {
  currentOutline = [];
}
