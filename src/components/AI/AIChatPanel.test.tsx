import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AIChatPanel } from "./AIChatPanel";
import { useEditorStore } from "../../stores/editorStore";
import { loadWorkspaceAiContext } from "../../lib/agent/workspaceContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage = (_message: string) => {}; },
}));
vi.mock("../../lib/tauriRuntime", () => ({ isTauriRuntime: () => false }));
vi.mock("../../lib/agent/workspaceContext", () => ({ loadWorkspaceAiContext: vi.fn() }));

const initialState = useEditorStore.getState();
type StreamArgs = { onChunk: { onmessage: (message: string) => void } };
let stream: StreamArgs;
let complete: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ ...initialState, aiProvider: "ollama", workspacePath: "/work", chatSessions: [], activeChatSessionId: null, streamingChatSessionId: null });
  vi.mocked(loadWorkspaceAiContext).mockResolvedValue("");
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_ollama_models") return [];
    if (command === "stream_ai_chat") {
      stream = args as unknown as StreamArgs;
      return new Promise<void>((resolve) => { complete = resolve; });
    }
    if (command === "cancel_ai_stream") complete?.();
    return undefined;
  });
});

afterEach(cleanup);

async function send() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Improve this paragraph" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stream_ai_chat", expect.anything()));
}

async function finish(text: string) {
  await act(async () => { stream.onChunk.onmessage(text); complete(); });
}

describe("chat request isolation", () => {
  it("creates just one usable conversation without a workspace", async () => {
    useEditorStore.setState({ workspacePath: null });
    render(<AIChatPanel />);
    await send();
    await finish("Hello");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("keeps late chunks in the originating conversation after switching sessions", async () => {
    render(<AIChatPanel />);
    const firstId = useEditorStore.getState().activeChatSessionId;
    await send();
    act(() => useEditorStore.getState().createChatSession());
    const secondId = useEditorStore.getState().activeChatSessionId;
    await finish("Reply for first chat");
    const sessions = useEditorStore.getState().chatSessions;
    expect(sessions.find((session) => session.id === firstId)?.messages.slice(-1)[0]?.content).toBe("Reply for first chat");
    expect(sessions.find((session) => session.id === secondId)?.messages).toEqual([]);
    expect(screen.queryByText("Reply for first chat")).not.toBeInTheDocument();
  });

  it("blocks overlapping native streams while another conversation is responding", async () => {
    render(<AIChatPanel />);
    await send();
    act(() => useEditorStore.getState().createChatSession());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second request" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "stream_ai_chat")).toHaveLength(1);
    await finish("Done");
  });

  it("never applies a cancelled Act response", async () => {
    useEditorStore.getState().openTab("/work/paper.md", "paper.md", "Original");
    const replace = vi.fn();
    window.addEventListener("editor:replace-document", replace);
    try {
      render(<AIChatPanel />);
      fireEvent.click(screen.getByRole("checkbox"));
      await send();
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await finish("<replace_document>Late overwrite</replace_document>");
      expect(replace).not.toHaveBeenCalled();
      expect(useEditorStore.getState().streamingChatSessionId).toBeNull();
    } finally { window.removeEventListener("editor:replace-document", replace); }
  });

  it("preserves proposed edits when the source document changes during a request", async () => {
    useEditorStore.getState().openTab("/work/paper.md", "paper.md", "Original");
    const replace = vi.fn();
    window.addEventListener("editor:replace-document", replace);
    try {
      render(<AIChatPanel />);
      fireEvent.click(screen.getByRole("checkbox"));
      await send();
      act(() => useEditorStore.getState().updateTabContent("/work/paper.md", "New user edits"));
      await finish("<replace_document>Proposed edit</replace_document>");
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByText(/The editor changed while this request was running/)).toBeInTheDocument();
    } finally { window.removeEventListener("editor:replace-document", replace); }
  });

  it("applies a valid edit to an unchanged originating document", async () => {
    useEditorStore.getState().openTab("/work/paper.md", "paper.md", "Original");
    const replace = vi.fn();
    window.addEventListener("editor:replace-document", replace);
    try {
      render(<AIChatPanel />);
      fireEvent.click(screen.getByRole("checkbox"));
      await send();
      await finish("<replace_document>Revised</replace_document>");
      expect(replace).toHaveBeenCalledOnce();
      expect((replace.mock.calls[0][0] as CustomEvent).detail).toBe("Revised");
    } finally { window.removeEventListener("editor:replace-document", replace); }
  });

  it("renders incomplete Markdown block starts without hanging", async () => {
    render(<AIChatPanel />);
    await send();
    await finish("``` code with spaces\n# \nStill responding");
    expect(screen.getByText(/Still responding/)).toBeInTheDocument();
  });
});
