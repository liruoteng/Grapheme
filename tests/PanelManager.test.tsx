import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelManager, type PanelContents } from "../src/components/Layout/PanelManager";
import { useEditorStore } from "../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));

const contents: PanelContents = {
  ai: <div>AI content</div>,
  editor: <div>Editor content</div>,
  preview: <div>Preview content</div>,
  diff: <div>Diff content</div>,
  outline: <div>Outline content</div>,
  pdf: <div>PDF content</div>,
  bibliography: <div>Bibliography content</div>,
  profiler: <div>Profiler content</div>,
};

describe("PanelManager", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activePanels: [],
      panelLayout: "horizontal",
    });
  });

  it("renders a single panel without crashing", () => {
    useEditorStore.setState({ activePanels: ["editor"] });

    render(<PanelManager contents={contents} />);

    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Editor content")).toBeInTheDocument();
  });

  it("stops row resizing if pointer release is missed", () => {
    useEditorStore.setState({
      activePanels: ["editor", "preview"],
      panelLayout: "vertical",
    });

    const { container } = render(<PanelManager contents={contents} />);
    const handle = container.querySelector(".pm-row-handle");

    expect(handle).toBeInTheDocument();
    fireEvent.pointerDown(handle!, { clientY: 100, buttons: 1, pointerId: 1 });
    expect(document.body).toHaveClass("pm-resizing-row");

    fireEvent.pointerMove(window, { clientY: 120, buttons: 0, pointerId: 1 });
    expect(document.body).not.toHaveClass("pm-resizing-row");
  });

  it("stops column resizing if pointer release is missed", () => {
    useEditorStore.setState({
      activePanels: ["editor", "preview"],
      panelLayout: "horizontal",
    });

    const { container } = render(<PanelManager contents={contents} />);
    const handle = container.querySelector(".pm-col-handle");

    expect(handle).toBeInTheDocument();
    fireEvent.pointerDown(handle!, { clientX: 100, buttons: 1, pointerId: 1 });
    expect(document.body).toHaveClass("pm-resizing-col");

    fireEvent.pointerMove(window, { clientX: 120, buttons: 0, pointerId: 1 });
    expect(document.body).not.toHaveClass("pm-resizing-col");
  });
});
