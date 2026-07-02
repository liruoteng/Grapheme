import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { usePreview, type SaveEvent } from "./usePreview";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../stores/editorStore";

describe("usePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      tabs: [],
      activeTabPath: null,
      previewError: null,
    });
  });

  it("does nothing when saveEvent is null", () => {
    renderHook(() => usePreview(null));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing for .typ files", () => {
    const event: SaveEvent = { path: "/foo/bar.typ", n: 1 };
    renderHook(() => usePreview(event));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing for unsupported file extensions", () => {
    const event: SaveEvent = { path: "/foo/bar.txt", n: 1 };
    renderHook(() => usePreview(event));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing for .md files when no matching tab exists", () => {
    const event: SaveEvent = { path: "/foo/bar.md", n: 1 };
    renderHook(() => usePreview(event));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("calls invoke for .md files with a matching tab", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    useEditorStore.setState({
      tabs: [{ path: "/foo/bar.md", name: "bar.md", content: "# Hello", isDirty: false }],
      activeTabPath: "/foo/bar.md",
    });
    const event: SaveEvent = { path: "/foo/bar.md", n: 1 };
    renderHook(() => usePreview(event));

    expect(invoke).toHaveBeenCalledWith(
      "validate_preview_sidecar_content",
      { path: "/foo/bar.md", content: "# Hello" },
    );
  });

  it("calls invoke for .markdown files with a matching tab", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    useEditorStore.setState({
      tabs: [{ path: "/foo/bar.markdown", name: "bar.markdown", content: "content", isDirty: false }],
      activeTabPath: "/foo/bar.markdown",
    });
    const event: SaveEvent = { path: "/foo/bar.markdown", n: 1 };
    renderHook(() => usePreview(event));

    expect(invoke).toHaveBeenCalledWith(
      "validate_preview_sidecar_content",
      { path: "/foo/bar.markdown", content: "content" },
    );
  });

  it("sets previewError when invoke returns a diagnostic string", async () => {
    vi.mocked(invoke).mockResolvedValue("syntax error on line 3");
    useEditorStore.setState({
      tabs: [{ path: "/a.md", name: "a.md", content: "bad", isDirty: false }],
      activeTabPath: "/a.md",
    });
    renderHook(() => usePreview({ path: "/a.md", n: 1 }));

    await vi.waitFor(() => {
      expect(useEditorStore.getState().previewError).toBe("syntax error on line 3");
    });
  });

  it("clears previewError when invoke returns null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    useEditorStore.setState({
      tabs: [{ path: "/a.md", name: "a.md", content: "ok", isDirty: false }],
      activeTabPath: "/a.md",
      previewError: "old error",
    });
    renderHook(() => usePreview({ path: "/a.md", n: 1 }));

    await vi.waitFor(() => {
      expect(useEditorStore.getState().previewError).toBeNull();
    });
  });

  it("sets previewError when invoke rejects", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("sidecar not running"));
    useEditorStore.setState({
      tabs: [{ path: "/a.md", name: "a.md", content: "x", isDirty: false }],
      activeTabPath: "/a.md",
    });
    renderHook(() => usePreview({ path: "/a.md", n: 1 }));

    await vi.waitFor(() => {
      expect(useEditorStore.getState().previewError).toContain("sidecar not running");
    });
  });

  it("does not re-invoke when saveEvent.n stays the same on rerender", () => {
    vi.mocked(invoke).mockResolvedValue(null);
    useEditorStore.setState({
      tabs: [{ path: "/a.md", name: "a.md", content: "x", isDirty: false }],
      activeTabPath: "/a.md",
    });
    const event: SaveEvent = { path: "/a.md", n: 1 };
    const { rerender } = renderHook(
      ({ e }) => usePreview(e),
      { initialProps: { e: event } },
    );
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender({ e: { path: "/a.md", n: 1 } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("re-invokes when saveEvent.n changes", () => {
    vi.mocked(invoke).mockResolvedValue(null);
    useEditorStore.setState({
      tabs: [{ path: "/a.md", name: "a.md", content: "x", isDirty: false }],
      activeTabPath: "/a.md",
    });
    const { rerender } = renderHook(
      ({ e }) => usePreview(e),
      { initialProps: { e: { path: "/a.md", n: 1 } as SaveEvent } },
    );
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender({ e: { path: "/a.md", n: 2 } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
