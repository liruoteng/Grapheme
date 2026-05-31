import { describe, expect, it } from "vitest";
import {
  getAcademicWorkflowPrompt,
  getGraphemeActionSystemPrompt,
  getGraphemeWritingSystemPrompt,
  isReadOnlyAcademicMode,
  type AcademicWorkflowMode,
} from "./graphemeWritingPrompt";

const MODES: AcademicWorkflowMode[] = [
  "clarify",
  "research",
  "outline",
  "draft",
  "review",
  "revise",
  "citation-audit",
];

describe("grapheme writing prompts", () => {
  it("includes the selected workflow instructions in chat and act prompts", () => {
    for (const mode of MODES) {
      const workflowPrompt = getAcademicWorkflowPrompt(mode);
      expect(getGraphemeWritingSystemPrompt(mode)).toContain(workflowPrompt);
      expect(getGraphemeActionSystemPrompt(mode)).toContain(workflowPrompt);
    }
  });

  it("keeps review and citation audit read-only", () => {
    expect(isReadOnlyAcademicMode("review")).toBe(true);
    expect(isReadOnlyAcademicMode("citation-audit")).toBe(true);
    expect(isReadOnlyAcademicMode("revise")).toBe(false);
  });

  it("requires material gaps instead of unsupported draft claims", () => {
    expect(getAcademicWorkflowPrompt("draft")).toContain("[MATERIAL GAP:");
    expect(getGraphemeActionSystemPrompt("revise")).toContain("[MATERIAL GAP]");
  });
});
