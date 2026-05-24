import { render, screen } from "@testing-library/react";
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
});
