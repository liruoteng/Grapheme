import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useEditorStore } from "../../stores/editorStore";

vi.mock("@monaco-editor/react", () => ({
  useMonaco: () => null,
}));

beforeEach(() => {
  useEditorStore.setState({
    tabs: [],
    activeTabPath: null,
    converterWarnings: [],
    editorFontSize: 14,
    lastEditTime: null,
    lastCompileMs: null,
  });
});

describe("StatusBar", () => {
  it("renders LSP status indicator", () => {
    render(<StatusBar lspStatus="disconnected" />);
    expect(screen.getByText(/Tinymist: disconnected/)).toBeInTheDocument();
  });

  it("renders connected LSP status", () => {
    render(<StatusBar lspStatus="connected" />);
    expect(screen.getByText(/Tinymist: connected/)).toBeInTheDocument();
  });

  it("renders connecting LSP status", () => {
    render(<StatusBar lspStatus="connecting" />);
    expect(screen.getByText(/Tinymist: connecting/)).toBeInTheDocument();
  });

  it("shows converter warnings", () => {
    useEditorStore.setState({ converterWarnings: ["Warning A", "Warning B"] });
    render(<StatusBar />);
    expect(screen.getByText("2 simplified")).toBeInTheDocument();
  });

  it("shows font size widget", () => {
    render(<StatusBar />);
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("decreases font size with minus button", () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTitle("Decrease font size"));
    expect(useEditorStore.getState().editorFontSize).toBe(13);
  });

  it("increases font size with plus button", () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTitle("Increase font size"));
    expect(useEditorStore.getState().editorFontSize).toBe(15);
  });

  it("disables minus button at min font size", () => {
    useEditorStore.setState({ editorFontSize: 8 });
    render(<StatusBar />);
    expect(screen.getByTitle("Decrease font size")).toBeDisabled();
  });

  it("disables plus button at max font size", () => {
    useEditorStore.setState({ editorFontSize: 32 });
    render(<StatusBar />);
    expect(screen.getByTitle("Increase font size")).toBeDisabled();
  });

  it("opens and closes font size menu", () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTitle("Adjust font size"));
    expect(document.querySelector(".font-size-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Adjust font size"));
    expect(document.querySelector(".font-size-menu")).not.toBeInTheDocument();
  });

  it("sets font size from preset button", () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTitle("Adjust font size"));
    fireEvent.click(screen.getByText("18"));
    expect(useEditorStore.getState().editorFontSize).toBe(18);
    expect(document.querySelector(".font-size-menu")).not.toBeInTheDocument();
  });

  it("shows language label for active tab", () => {
    useEditorStore.getState().openTab("/doc.ts", "doc.ts", "");
    render(<StatusBar />);
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("shows language label for Typst file", () => {
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "");
    render(<StatusBar />);
    expect(screen.getByText("Typst")).toBeInTheDocument();
  });

  it("shows Plain Text for unknown extension", () => {
    useEditorStore.getState().openTab("/doc.xyz", "doc.xyz", "");
    render(<StatusBar />);
    expect(screen.getByText("Plain Text")).toBeInTheDocument();
  });

  it("shows UTF-8 when a tab is open", () => {
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "");
    render(<StatusBar />);
    expect(screen.getByText("UTF-8")).toBeInTheDocument();
  });

  it("shows edit time when lastEditTime is recent", () => {
    useEditorStore.setState({ lastEditTime: Date.now() - 5000 });
    render(<StatusBar />);
    expect(screen.getByText(/just now|s ago/)).toBeInTheDocument();
  });

  it("shows compile time when lastCompileMs is set", () => {
    useEditorStore.setState({ lastCompileMs: 42 });
    render(<StatusBar />);
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("shows compile time in seconds when >= 1000ms", () => {
    useEditorStore.setState({ lastCompileMs: 2500 });
    render(<StatusBar />);
    expect(screen.getByText("2.5s")).toBeInTheDocument();
  });

  it("history button is disabled when no tab is open", () => {
    render(<StatusBar />);
    const btn = screen.getByTitle("File history");
    expect(btn).toBeDisabled();
  });

  it("history button is enabled when a tab is open", () => {
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "");
    render(<StatusBar />);
    expect(screen.getByTitle("File history")).not.toBeDisabled();
  });

  it("calls onShowHistory when history button is clicked", () => {
    const onShowHistory = vi.fn();
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "");
    render(<StatusBar onShowHistory={onShowHistory} />);
    fireEvent.click(screen.getByTitle("File history"));
    expect(onShowHistory).toHaveBeenCalled();
  });
});
