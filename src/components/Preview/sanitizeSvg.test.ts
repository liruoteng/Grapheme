import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitizeSvg";

describe("sanitizeSvg", () => {
  it("preserves safe Typst drawing markup", () => {
    const result = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="black"/><text x="1" y="2">Hello</text></svg>',
    );

    expect(result).toContain("<path");
    expect(result).toContain("<text");
    expect(result).toContain("Hello");
  });

  it("removes active elements, handlers, and external URLs", () => {
    const result = sanitizeSvg(
      '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><image href="javascript:alert(1)"/><path onclick="alert(1)" style="fill:url(https://evil.test/x)" d="M0 0"/></svg>',
    );

    expect(result).not.toContain("script");
    expect(result).not.toContain("foreignObject");
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("https://evil.test");
  });

  it("allows local fragment and embedded image references", () => {
    const result = sanitizeSvg(
      '<svg><use href="#glyph"/><image href="data:image/png;base64,AAAA"/></svg>',
    );

    expect(result).toContain('href="#glyph"');
    expect(result).toContain("data:image/png;base64,AAAA");
  });
});
