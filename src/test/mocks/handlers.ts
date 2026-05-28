import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("https://api.semanticscholar.org/graph/v1/paper/search", () => {
    return HttpResponse.json({
      total: 1,
      offset: 0,
      data: [
        {
          paperId: "abc123",
          title: "Mock Paper Title",
          authors: [{ name: "Jane Doe" }],
          year: 2024,
          abstract: "A mock abstract for testing.",
          citationCount: 42,
          externalIds: { DOI: "10.1234/mock" },
        },
      ],
    });
  }),

  http.get("https://api.crossref.org/works/:doi", ({ params }) => {
    return HttpResponse.json({
      status: "ok",
      message: {
        DOI: params.doi,
        title: ["Mock DOI Title"],
        author: [{ given: "John", family: "Smith" }],
        "published-print": { "date-parts": [[2023]] },
      },
    });
  }),

  http.get("http://localhost:11434/api/tags", () => {
    return HttpResponse.json({
      models: [
        { name: "llama3.2", size: 2_000_000_000 },
        { name: "mistral", size: 4_000_000_000 },
      ],
    });
  }),

  http.post("http://localhost:11434/api/chat", () => {
    return HttpResponse.json({
      model: "llama3.2",
      message: { role: "assistant", content: "Mock AI response" },
      done: true,
    });
  }),
];
