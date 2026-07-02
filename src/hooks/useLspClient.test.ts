import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockStop = vi.fn();
const mockHandle = {
  notifyOpen: vi.fn(),
  notifyChange: vi.fn(),
  notifySave: vi.fn(),
  stop: mockStop,
};

vi.mock("../components/Editor/lsp-client", () => ({
  startLspClient: vi.fn(() => mockHandle),
}));

import { useLspClient } from "./useLspClient";
import { startLspClient } from "../components/Editor/lsp-client";
import { useEditorStore } from "../stores/editorStore";

describe("useLspClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ lspStatus: "disconnected" });
  });

  it("returns null when monaco is null", () => {
    const { result } = renderHook(() => useLspClient(null));
    expect(result.current).toBeNull();
  });

  it("does not call startLspClient when monaco is null", () => {
    renderHook(() => useLspClient(null));
    expect(startLspClient).not.toHaveBeenCalled();
  });

  it("calls startLspClient when monaco is provided", () => {
    const fakeMonaco = {} as typeof import("monaco-editor");
    renderHook(() => useLspClient(fakeMonaco));
    expect(startLspClient).toHaveBeenCalledWith(
      fakeMonaco,
      expect.any(Function),
    );
  });

  it("returns the handle from startLspClient", () => {
    const fakeMonaco = {} as typeof import("monaco-editor");
    const { result } = renderHook(() => useLspClient(fakeMonaco));
    expect(result.current).toBe(mockHandle);
  });

  it("calls stop on unmount", () => {
    const fakeMonaco = {} as typeof import("monaco-editor");
    const { unmount } = renderHook(() => useLspClient(fakeMonaco));
    unmount();
    expect(mockStop).toHaveBeenCalled();
  });

  it("passes setLspStatus callback to startLspClient", () => {
    const fakeMonaco = {} as typeof import("monaco-editor");
    renderHook(() => useLspClient(fakeMonaco));
    const statusCallback = vi.mocked(startLspClient).mock.calls[0][1];
    statusCallback("connected");
    expect(useEditorStore.getState().lspStatus).toBe("connected");
  });

  it("restarts client when monaco changes", () => {
    const monaco1 = { v: 1 } as unknown as typeof import("monaco-editor");
    const monaco2 = { v: 2 } as unknown as typeof import("monaco-editor");
    const { rerender } = renderHook(
      ({ m }) => useLspClient(m),
      { initialProps: { m: monaco1 } },
    );
    expect(startLspClient).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();

    rerender({ m: monaco2 });
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(startLspClient).toHaveBeenCalledTimes(2);
  });
});
