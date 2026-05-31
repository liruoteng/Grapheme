import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  getSlashCommandQuery,
  GRAPHEME_SLASH_COMMANDS,
} from "./slashCommands";

describe("grapheme slash commands", () => {
  it("shows all writing modes for a bare slash", () => {
    expect(filterSlashCommands("/")).toEqual(GRAPHEME_SLASH_COMMANDS);
  });

  it("filters commands by command name and description", () => {
    expect(filterSlashCommands("/rev").map((command) => command.command)).toEqual([
      "review",
      "revise",
    ]);
    expect(filterSlashCommands("/bib").map((command) => command.command)).toEqual([
      "cite",
    ]);
  });

  it("stops offering commands after the user starts writing arguments", () => {
    expect(getSlashCommandQuery("/cite")).toBe("cite");
    expect(getSlashCommandQuery("/cite transformers")).toBeNull();
    expect(filterSlashCommands("Please review this")).toEqual([]);
  });
});
