import { buildTool } from "../buildTool";

type CitationAction = "add" | "remove" | "list" | "format";

interface CitationInput {
  action: CitationAction;
  bibKey?: string;
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  abstract?: string;
  style?: string;
}

interface CitationEntry {
  bibKey: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  bibEntry: string;
}

interface CitationResult {
  action: CitationAction;
  entries: CitationEntry[];
  formatted?: string;
  message?: string;
}

const citationStore = new Map<string, CitationEntry>();

function generateBibKey(authors: string[], year: number): string {
  const firstAuthor = authors[0] ?? "unknown";
  const lastName =
    firstAuthor.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ??
    "unknown";
  return `${lastName}${year}`;
}

function generateBibEntry(entry: CitationEntry): string {
  const authors = entry.authors.join(" and ");
  const doi = entry.doi ? `\n  doi = {${entry.doi}},` : "";
  return `@article{${entry.bibKey},
  title = {${entry.title}},
  author = {${authors}},
  year = {${entry.year}},${doi}
}`;
}

export const CitationTool = buildTool<CitationInput, CitationResult>({
  name: "Citation",
  description:
    "Manage paper citations. Actions: 'add' to add a new citation, 'remove' to delete by bibKey, 'list' to show all citations, 'format' to generate formatted bibliography.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove", "list", "format"],
        description: "The action to perform on citations",
      },
      bibKey: {
        type: "string",
        description: "Citation key (required for remove)",
      },
      title: { type: "string", description: "Paper title (for add)" },
      authors: {
        type: "array",
        items: { type: "string" },
        description: "List of author names (for add)",
      },
      year: { type: "number", description: "Publication year (for add)" },
      doi: { type: "string", description: "DOI identifier (for add)" },
      abstract: { type: "string", description: "Paper abstract (for add)" },
      style: {
        type: "string",
        description: "Citation style for format action (apa, ieee, chicago)",
      },
    },
    required: ["action"],
  },
  isReadOnly: (input) => input.action === "list" || input.action === "format",
  async call(input) {
    switch (input.action) {
      case "add": {
        if (!input.title || !input.authors?.length || !input.year) {
          return {
            data: { action: "add", entries: [] },
            error: "title, authors, and year are required",
          };
        }
        const bibKey = input.bibKey ?? generateBibKey(input.authors, input.year);
        const entry: CitationEntry = {
          bibKey,
          title: input.title,
          authors: input.authors,
          year: input.year,
          doi: input.doi,
          bibEntry: "",
        };
        entry.bibEntry = generateBibEntry(entry);
        citationStore.set(bibKey, entry);
        return {
          data: { action: "add", entries: [entry], message: `Added @${bibKey}` },
        };
      }

      case "remove": {
        if (!input.bibKey) {
          return {
            data: { action: "remove", entries: [] },
            error: "bibKey is required",
          };
        }
        const removed = citationStore.delete(input.bibKey);
        return {
          data: {
            action: "remove",
            entries: [],
            message: removed ? `Removed @${input.bibKey}` : "Not found",
          },
        };
      }

      case "list": {
        const entries = Array.from(citationStore.values());
        return { data: { action: "list", entries } };
      }

      case "format": {
        const entries = Array.from(citationStore.values());
        const formatted = entries.map((e) => e.bibEntry).join("\n\n");
        return { data: { action: "format", entries, formatted } };
      }
    }
  },
  prompt() {
    return `Use Citation to manage bibliography. Add citations with 'add' action providing title, authors, year. Use 'list' to see all citations, 'format' to generate BibTeX output. Reference citations in text as @bibKey.`;
  },
});

export function clearCitationStore(): void {
  citationStore.clear();
}
