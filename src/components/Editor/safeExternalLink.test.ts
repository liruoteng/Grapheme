import { describe, expect, it } from "vitest";
import { safeExternalLink } from "./safeExternalLink";

describe("safeExternalLink", () => {
  it.each(["https://example.com/a?q=1", "http://localhost:3000", "mailto:author@example.com", " HTTPS://example.com "])("allows web and email destinations: %s", (href) => {
    expect(safeExternalLink(href)).toBe(href.trim());
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "file:///private/file", "vscode://file/private/file", "smb://host/share", "//example.com", "relative.md", "http:\n//example.com", ""])("rejects unsupported or malformed destinations: %s", (href) => {
    expect(safeExternalLink(href)).toBeNull();
  });
});
