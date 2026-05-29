import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import { useEditorStore } from "../../stores/editorStore";

function defaultProps(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  return {
    onExportPdf: vi.fn(),
    onConvertToTypst: vi.fn(),
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    sidebarWidth: 260,
    sidebarTab: "files" as const,
    previewOpen: true,
    onTogglePreview: vi.fn(),
    showAiPanel: false,
    onToggleAiPanel: vi.fn(),
    tabBar: null,
    onExplorerNewFile: vi.fn(),
    onExplorerNewFolder: vi.fn(),
    onExplorerRefresh: vi.fn(),
    onExplorerOpenFolder: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.setState({
    activeTabPath: null,
    workspacePath: null,
    theme: "dark",
    writingMode: false,
    tabs: [],
  });
});

describe("Toolbar", () => {
  it("renders", () => {
    render(<Toolbar {...defaultProps()} />);
    expect(document.querySelector(".toolbar")).toBeInTheDocument();
  });

  it("toggles sidebar on button click", () => {
    const onToggleSidebar = vi.fn();
    render(<Toolbar {...defaultProps({ onToggleSidebar })} />);
    fireEvent.click(screen.getByTitle("Hide sidebar"));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("shows Show sidebar title when sidebar is closed", () => {
    render(<Toolbar {...defaultProps({ sidebarOpen: false })} />);
    expect(screen.getByTitle("Show sidebar")).toBeInTheDocument();
  });

  it("calls onExportPdf when disabled state is false", () => {
    const onExportPdf = vi.fn();
    useEditorStore.setState({ activeTabPath: "/doc.typ" });
    render(<Toolbar {...defaultProps({ onExportPdf })} />);
    const btn = screen.getByTitle("Export PDF");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onExportPdf).toHaveBeenCalled();
  });

  it("exports PDF button is disabled when no .typ file is active", () => {
    render(<Toolbar {...defaultProps()} />);
    expect(screen.getByTitle("Export PDF")).toBeDisabled();
  });

  it("toggles AI panel", () => {
    const onToggleAiPanel = vi.fn();
    render(<Toolbar {...defaultProps({ onToggleAiPanel })} />);
    fireEvent.click(screen.getByTitle("Open AI assistant"));
    expect(onToggleAiPanel).toHaveBeenCalled();
  });

  it("shows Close AI assistant title when AI panel is open", () => {
    render(<Toolbar {...defaultProps({ showAiPanel: true })} />);
    expect(screen.getByTitle("Close AI assistant")).toBeInTheDocument();
  });

  it("toggles preview", () => {
    const onTogglePreview = vi.fn();
    render(<Toolbar {...defaultProps({ onTogglePreview })} />);
    fireEvent.click(screen.getByTitle("Hide preview"));
    expect(onTogglePreview).toHaveBeenCalled();
  });

  it("shows Show preview title when preview is closed", () => {
    render(<Toolbar {...defaultProps({ previewOpen: false })} />);
    expect(screen.getByTitle("Show preview")).toBeInTheDocument();
  });

  it("toggles theme", () => {
    expect(useEditorStore.getState().theme).toBe("dark");
    render(<Toolbar {...defaultProps()} />);
    fireEvent.click(screen.getByTitle("Switch to light theme"));
    expect(useEditorStore.getState().theme).toBe("claude");
  });

  it("toggles writing mode", () => {
    useEditorStore.setState({ activeTabPath: "/doc.typ" });
    render(<Toolbar {...defaultProps()} />);
    const btn = screen.getByTitle("Enter writing mode");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(useEditorStore.getState().writingMode).toBe(true);
  });

  it("writing mode button is disabled when no tab is open", () => {
    render(<Toolbar {...defaultProps()} />);
    expect(screen.getByTitle("Enter writing mode")).toBeDisabled();
  });

  it("shows dirty badge when active tab is dirty", () => {
    useEditorStore.getState().openTab("/doc.typ", "doc.typ", "content");
    useEditorStore.getState().updateTabContent("/doc.typ", "modified");
    render(<Toolbar {...defaultProps()} />);
    expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
  });

  it("shows .typ convert button when file is .md", () => {
    useEditorStore.setState({ activeTabPath: "/doc.md" });
    const onConvertToTypst = vi.fn();
    render(<Toolbar {...defaultProps({ onConvertToTypst })} />);
    fireEvent.click(screen.getByTitle("Convert to Typst (one-way; original .md is kept)"));
    expect(onConvertToTypst).toHaveBeenCalled();
  });

  it("calls explorer action callbacks", () => {
    useEditorStore.setState({ workspacePath: "/workspace" });
    const onExplorerNewFile = vi.fn();
    const onExplorerRefresh = vi.fn();
    const onExplorerOpenFolder = vi.fn();
    render(
      <Toolbar
        {...defaultProps({
          onExplorerNewFile,
          onExplorerRefresh,
          onExplorerOpenFolder,
        })}
      />,
    );
    fireEvent.click(screen.getByTitle("New File"));
    expect(onExplorerNewFile).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(onExplorerRefresh).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Open Folder"));
    expect(onExplorerOpenFolder).toHaveBeenCalled();
  });

  it("does not show explorer file actions when workspacePath is null", () => {
    render(<Toolbar {...defaultProps()} />);
    expect(screen.queryByTitle("New File")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Refresh")).not.toBeInTheDocument();
  });
});
