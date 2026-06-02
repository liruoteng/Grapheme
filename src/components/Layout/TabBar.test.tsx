import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import { useEditorStore } from "../../stores/editorStore";

beforeEach(() => {
  useEditorStore.setState({
    tabs: [],
    activeTabPath: null,
  });
});

describe("TabBar", () => {
  it("returns null when there are no tabs", () => {
    const { container } = render(<TabBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tabs", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "");
    render(<TabBar />);
    expect(screen.getByText("a.typ")).toBeInTheDocument();
    expect(screen.getByText("b.typ")).toBeInTheDocument();
  });

  it("marks the active tab with active class", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "");
    useEditorStore.getState().setActiveTab("/a.typ");
    render(<TabBar />);
    const tabs = document.querySelectorAll(".tab");
    expect(tabs[0].classList.contains("active")).toBe(true);
    expect(tabs[1].classList.contains("active")).toBe(false);
  });

  it("switches active tab on click", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "");
    render(<TabBar />);
    fireEvent.click(screen.getByText("b.typ"));
    expect(useEditorStore.getState().activeTabPath).toBe("/b.typ");
  });

  it("closes a tab when close button is clicked", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    render(<TabBar />);
    const closeBtn = document.querySelector(".tab-close")!;
    fireEvent.click(closeBtn);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it("shows context menu on right-click", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByText("a.typ"));
    expect(screen.getByText("Close Tab")).toBeInTheDocument();
    expect(screen.getByText("Copy Path")).toBeInTheDocument();
  });

  it('"Close Tab" in context menu closes the tab', () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByText("a.typ"));
    fireEvent.click(screen.getByText("Close Tab"));
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('"Copy Path" in context menu copies to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByText("a.typ"));
    fireEvent.click(screen.getByText("Copy Path"));
    expect(writeText).toHaveBeenCalledWith("/a.typ");
  });

  it('"Close All Tabs" in context menu closes all tabs', () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "");
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByText("a.typ"));
    fireEvent.click(screen.getByText("Close All Tabs"));
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
