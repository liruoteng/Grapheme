import { buildTool } from "../buildTool";

interface SearchInput {
  query: string;
  maxResults: number;
  yearFrom?: number;
  yearTo?: number;
}

interface Paper {
  paperId: string;
  title: string;
  authors: string[];
  year: number;
  abstract: string;
  citationCount: number;
  doi?: string;
}

interface SearchResult {
  papers: Paper[];
  query: string;
  totalFound: number;
}

async function searchSemanticScholar(
  query: string,
  limit: number,
  yearFrom?: number,
  yearTo?: number,
): Promise<Paper[]> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: "title,authors,year,abstract,citationCount,externalIds",
  });

  if (yearFrom || yearTo) {
    const yearRange = `${yearFrom ?? ""}:${yearTo ?? ""}`;
    params.set("year", yearRange);
  }

  const response = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
  );

  if (!response.ok) {
    throw new Error(`Semantic Scholar API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.data ?? []).map(
    (p: {
      paperId: string;
      title: string;
      authors: { name: string }[];
      year: number;
      abstract: string;
      citationCount: number;
      externalIds?: { DOI?: string };
    }) => ({
      paperId: p.paperId,
      title: p.title,
      authors: p.authors.map((a) => a.name),
      year: p.year,
      abstract: p.abstract,
      citationCount: p.citationCount,
      doi: p.externalIds?.DOI,
    }),
  );
}

export const LiteratureSearchTool = buildTool<SearchInput, SearchResult>({
  name: "LiteratureSearch",
  description:
    "Search academic databases (Semantic Scholar) for relevant research papers. Returns papers with title, authors, year, abstract, and citation count.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for finding academic papers",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
      },
      yearFrom: {
        type: "number",
        description: "Filter papers published from this year onwards",
      },
      yearTo: {
        type: "number",
        description: "Filter papers published up to this year",
      },
    },
    required: ["query"],
  },
  isReadOnly: () => true,
  async call(input) {
    const limit = input.maxResults ?? 10;
    try {
      const papers = await searchSemanticScholar(
        input.query,
        limit,
        input.yearFrom,
        input.yearTo,
      );
      return {
        data: { papers, query: input.query, totalFound: papers.length },
      };
    } catch (err) {
      return {
        data: { papers: [], query: input.query, totalFound: 0 },
        error: err instanceof Error ? err.message : "Search failed",
      };
    }
  },
  prompt() {
    return `Use LiteratureSearch to find relevant academic papers. Provide specific search queries related to the research topic. Results include title, authors, year, abstract, and citation count to help assess relevance.`;
  },
});
