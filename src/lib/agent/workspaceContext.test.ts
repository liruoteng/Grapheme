import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadWorkspaceAiContext } from "./workspaceContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("workspace context", () => {
  it("supplies the current unsaved document without requiring an open workspace", async () => {
    const context = await loadWorkspaceAiContext(null, "/tmp/untitled.md", "My current draft");
    expect(context).toContain("My current draft");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("excludes hidden and credential files from automatic context", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === "list_dir" ? [
      { name: "paper.md", path: "/work/paper.md", is_dir: false },
      { name: ".env", path: "/work/.env", is_dir: false },
      { name: "credentials.json", path: "/work/credentials.json", is_dir: false },
      { name: "secret-key.txt", path: "/work/secret-key.txt", is_dir: false },
      { name: ".grapheme", path: "/work/.grapheme", is_dir: true },
    ] : "saved paper");
    const context = await loadWorkspaceAiContext("/work", "/work/paper.md", "unsaved paper");
    expect(context).toContain("unsaved paper");
    expect(context).not.toContain("credentials.json");
    expect(context).not.toContain("secret-key.txt");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("bounds traversal even when a large directory tree contains no candidate files", async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const { path } = args as { path: string };
      return Array.from({ length: 10 }, (_, index) => ({ name: `dir${index}`, path: `${path}/dir${index}`, is_dir: true }));
    });
    await loadWorkspaceAiContext("/work", null, null);
    expect(invoke).toHaveBeenCalledTimes(100);
  });

  it("does not read files after cancellation during discovery", async () => {
    const controller = new AbortController();
    vi.mocked(invoke).mockImplementation(async () => {
      controller.abort();
      return [{ name: "paper.md", path: "/work/paper.md", is_dir: false }];
    });
    await expect(loadWorkspaceAiContext("/work", null, null, [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("includes an explicitly approved file even when automatic discovery excludes its name", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_dir") throw new Error("not a directory");
      return "explicitly requested content";
    });
    const context = await loadWorkspaceAiContext(null, null, null, ["/external/secret-review.md"]);
    expect(context).toContain("explicitly requested content");
  });
});
