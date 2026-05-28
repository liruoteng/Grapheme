import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TableOfContents } from "./TableOfContents";
import { useEditorStore } from "../../stores/editorStore";

beforeEach(() => {
  useEditorStore.setState({
    tabs: [],
    activeTabPath: null,
    scrollToLine: null,
  });
});

describe("TableOfContents", () => {
  it('shows placeholder when no file is open', () => {
    render(<TableOfContents />);
    expect(screen.getByText("No .typ or .md file open")).toBeInTheDocument();
  });

  it("shows placeholder when non-typ/md file is open", () => {
    useEditorStore.getState().openTab("/file.py", "file.py", "# Not a heading");
    render(<TableOfContents />);
    expect(screen.getByText("No .typ or .md file open")).toBeInTheDocument();
  });

  it('shows "No headings found" for .typ file without headings', () => {
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "just body text");
    render(<TableOfContents />);
    expect(screen.getByText("No headings found")).toBeInTheDocument();
  });

  it('shows "No headings found" for .md file without headings', () => {
    useEditorStore.getState().openTab("/doc.md", "doc.md", "just body text");
    render(<TableOfContents />);
    expect(screen.getByText("No headings found")).toBeInTheDocument();
  });

  it("renders typst headings from a .typ file", () => {
    useEditorStore.getState().openTab(
      "/doc.typ",
      "doc.typ",
      "= Title\n\n== Section 1\n\n=== Subsection",
    );
    render(<TableOfContents />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Section 1")).toBeInTheDocument();
    expect(screen.getByText("Subsection")).toBeInTheDocument();
  });

  it("renders markdown headings from a .md file", () => {
    useEditorStore.getState().openTab(
      "/doc.md",
      "doc.md",
      "# Title\n\n## Section\n\n### Sub",
    );
    render(<TableOfContents />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(screen.getByText("Sub")).toBeInTheDocument();
  });

  it("sets scrollToLine when a heading is clicked", () => {
    useEditorStore.getState().openTab(
      "/doc.md",
      "doc.md",
      "# Title\n\n## Section",
    );
    render(<TableOfContents />);
    fireEvent.click(screen.getByText("Section"));
    expect(useEditorStore.getState().scrollToLine).toBe(3);
  });

  it("indents entries by heading level", () => {
    useEditorStore.getState().openTab(
      "/doc.typ",
      "doc.typ",
      "= H1\n\n== H2\n\n=== H3",
    );
    render(<TableOfContents />);
    const buttons = document.querySelectorAll(".toc-entry");
    expect(buttons).toHaveLength(3);
    expect((buttons[0] as HTMLElement).style.paddingLeft).toBe("12px");
    expect((buttons[1] as HTMLElement).style.paddingLeft).toBe("26px");
    expect((buttons[2] as HTMLElement).style.paddingLeft).toBe("40px");
  });
});
