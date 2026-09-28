import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "./editorStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const initialState = useEditorStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset().mockResolvedValue("");
  useEditorStore.setState({ ...initialState, chatSessions: [], activeChatSessionId: null, workspacePath: "/first" });
});
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); });

describe("project chat persistence", () => {
  it("saves each originating workspace even when the user switches before debounce", async () => {
    useEditorStore.getState().createChatSession();
    const first = useEditorStore.getState().activeChatSessionId!;
    useEditorStore.getState().updateChatSession(first, [{ role: "user", content: "first project" }]);
    useEditorStore.setState({ workspacePath: "/second" });
    useEditorStore.getState().createChatSession();
    const second = useEditorStore.getState().activeChatSessionId!;
    useEditorStore.getState().updateChatSession(second, [{ role: "user", content: "second project" }]);
    await vi.advanceTimersByTimeAsync(160);
    const writes = vi.mocked(invoke).mock.calls.filter(([command]) => command === "write_workspace_sessions");
    expect(writes).toHaveLength(2);
    expect(writes).toEqual(expect.arrayContaining([
      ["write_workspace_sessions", expect.objectContaining({ workspacePath: "/first", contents: expect.stringContaining("first project") })],
      ["write_workspace_sessions", expect.objectContaining({ workspacePath: "/second", contents: expect.stringContaining("second project") })],
    ]));
  });

  it("does not overwrite live messages when a disk read completes late", async () => {
    useEditorStore.getState().createChatSession();
    const id = useEditorStore.getState().activeChatSessionId!;
    let finish!: (contents: string) => void;
    vi.mocked(invoke).mockImplementation(async (command) => command === "read_workspace_sessions"
      ? new Promise<string>((resolve) => { finish = resolve; }) : "");
    const loading = useEditorStore.getState().loadWorkspaceSessions("/first");
    useEditorStore.getState().updateChatSessionLive(id, [{ role: "assistant", content: "Live reply" }]);
    finish(JSON.stringify([{ id, title: "Old", createdAt: 1, messages: [{ role: "assistant", content: "Stale reply" }] }]));
    await loading;
    expect(useEditorStore.getState().chatSessions.find((session) => session.id === id)?.messages[0].content).toBe("Live reply");
    expect(useEditorStore.getState().activeChatSessionId).toBe(id);
  });

  it("ignores malformed transcripts instead of passing invalid messages to the renderer", async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify([
      null,
      { id: "broken", title: 9, messages: [] },
      { id: "valid", title: "Chat", messages: [null, { role: "assistant", content: {} }, { role: "user", content: "Valid message" }] },
    ]));
    await useEditorStore.getState().loadWorkspaceSessions("/first");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
    expect(useEditorStore.getState().chatSessions[0].messages).toEqual([{ role: "user", content: "Valid message" }]);
  });
});
