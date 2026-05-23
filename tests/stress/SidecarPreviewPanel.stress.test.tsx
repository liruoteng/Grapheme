import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidecarPreviewPanel } from "../../src/components/Preview/SidecarPreviewPanel";
import { useEditorStore } from "../../src/stores/editorStore";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("SidecarPreviewPanel stress smoke", () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "start_sidecar_preview") {
        return Promise.resolve("http://127.0.0.1:23625/preview");
      }
      return Promise.resolve(null);
    });
  });

  it("renders a nonblank iframe for a markdown preview and shows recovered-preview state", async () => {
    useEditorStore.setState({
      activeTabPath: "/stress/preview.md",
      tabs: [
        {
          path: "/stress/preview.md",
          name: "preview.md",
          content: "# Preview\n\nBroken input should still render recovered preview.",
          isDirty: false,
        },
      ],
      previewError: "synthetic recovered preview diagnostic",
    });

    render(<SidecarPreviewPanel />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_sidecar_preview", {
        path: "/stress/preview.md",
        invertColors: "always",
      });
    });

    const iframe = await screen.findByTitle("Typst Preview");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", expect.stringContaining("127.0.0.1:23625/preview"));
    expect(screen.getByText("Syntax error - showing recovered preview")).toBeInTheDocument();
  });
});
