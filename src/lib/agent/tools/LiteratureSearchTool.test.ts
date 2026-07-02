import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/mocks/server";
import { LiteratureSearchTool } from "./LiteratureSearchTool";

const ctx = {};

describe("LiteratureSearchTool", () => {
  it("has correct metadata", () => {
    expect(LiteratureSearchTool.name).toBe("LiteratureSearch");
    expect(LiteratureSearchTool.isReadOnly({ query: "x", maxResults: 10 })).toBe(true);
  });

  it("returns papers from the Semantic Scholar API", async () => {
    const result = await LiteratureSearchTool.call(
      { query: "transformers", maxResults: 10 },
      ctx,
    );
    expect(result.error).toBeUndefined();
    expect(result.data.query).toBe("transformers");
    expect(result.data.papers).toHaveLength(1);
    expect(result.data.papers[0].title).toBe("Mock Paper Title");
    expect(result.data.papers[0].authors).toEqual(["Jane Doe"]);
    expect(result.data.papers[0].doi).toBe("10.1234/mock");
    expect(result.data.totalFound).toBe(1);
  });

  it("handles API errors gracefully", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const result = await LiteratureSearchTool.call(
      { query: "fail", maxResults: 5 },
      ctx,
    );
    expect(result.error).toContain("Semantic Scholar API error: 500");
    expect(result.data.papers).toHaveLength(0);
    expect(result.data.totalFound).toBe(0);
  });

  it("handles empty results", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", () => {
        return HttpResponse.json({ total: 0, offset: 0, data: [] });
      }),
    );

    const result = await LiteratureSearchTool.call(
      { query: "nothing", maxResults: 10 },
      ctx,
    );
    expect(result.data.papers).toHaveLength(0);
    expect(result.data.totalFound).toBe(0);
  });

  it("defaults maxResults to 10", async () => {
    const result = await LiteratureSearchTool.call(
      { query: "test" } as { query: string; maxResults: number },
      ctx,
    );
    expect(result.data.papers).toHaveLength(1);
  });

  it("passes year filters to the API", async () => {
    let capturedUrl = "";
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ total: 0, offset: 0, data: [] });
      }),
    );

    await LiteratureSearchTool.call(
      { query: "ml", maxResults: 5, yearFrom: 2020, yearTo: 2024 },
      ctx,
    );
    expect(capturedUrl).toContain("year=2020%3A2024");
  });

  it("returns a prompt string", () => {
    expect(LiteratureSearchTool.prompt()).toContain("LiteratureSearch");
  });
});
