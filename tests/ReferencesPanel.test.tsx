import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ReferencesPanel } from "../src/components/References/ReferencesPanel";
import { setActiveDragSource } from "../src/components/FileExplorer/fileDrag";
import { useEditorStore } from "../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ReferencesPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    setActiveDragSource(null);
    useEditorStore.setState({
      references: [],
      workspacePath: "/workspace",
      tabs: [],
      activeTabPath: null,
    });
  });

  it("imports a BibTeX file dragged from the file explorer", async () => {
    vi.mocked(invoke).mockResolvedValue(
      "@article{smith2024,\n  title = {A Useful Paper},\n  author = {Smith, Jane},\n  year = {2024}\n}"
    );
    setActiveDragSource("/workspace/refs.bib");

    render(<ReferencesPanel />);

    const dropzone = screen.getByRole("button", { name: "Add reference files" });
    const dataTransfer = {
      files: [],
      types: [],
      dropEffect: "move",
      getData: vi.fn(() => ""),
    };

    fireEvent.dragOver(dropzone, { dataTransfer });
    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("@smith2024")).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/workspace/refs.bib" });
  });
});
