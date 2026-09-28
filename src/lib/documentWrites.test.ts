import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { writeDocument } from "./documentWrites";
import { useEditorStore } from "../stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("document writes", () => {
  it("serializes writes to the same document and recovers after a failed save", async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(invoke).mockReset().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; })).mockResolvedValue(undefined);
    const first = writeDocument("/paper.md", "old");
    const failed = expect(first).rejects.toThrow("disk unavailable");
    const second = writeDocument("/paper.md", "latest");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rejectFirst(new Error("disk unavailable"));
    await failed;
    await second;
    expect(invoke).toHaveBeenNthCalledWith(2, "write_file", { path: "/paper.md", contents: "latest" });
  });

  it("keeps newer edits dirty when an older save completes", () => {
    useEditorStore.setState({ tabs: [], activeTabPath: null });
    useEditorStore.getState().openTab("/paper.md", "paper.md", "original");
    useEditorStore.getState().updateTabContent("/paper.md", "new edits");
    useEditorStore.getState().markTabClean("/paper.md", "original");
    expect(useEditorStore.getState().activeTab()?.isDirty).toBe(true);
    useEditorStore.getState().markTabClean("/paper.md", "new edits");
    expect(useEditorStore.getState().activeTab()?.isDirty).toBe(false);
  });
});
