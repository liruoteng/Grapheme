import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import { useEditorStore } from "../../stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

const onClose = vi.fn();

beforeEach(() => {
  useEditorStore.setState({
    confirmOnClose: true,
    editorFontSize: 14,
    editorTabSize: 2,
    editorWordWrap: true,
    editorMinimap: true,
    editorLineNumbers: true,
    editorWidth: 960,
    typewriterMode: false,
    useSidecarPreview: true,
    defaultPreviewZoom: 1,
    theme: "dark",
    aiProvider: "claude-cli",
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "llama3.2",
  });
  onClose.mockClear();
  vi.restoreAllMocks();
});

describe("SettingsDialog", () => {
  it("renders the dialog with title and default General section", () => {
    render(<SettingsDialog onClose={onClose} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Confirm before closing dirty tabs")).toBeInTheDocument();
  });

  it("renders all section nav items", () => {
    render(<SettingsDialog onClose={onClose} />);
    const navItems = document.querySelectorAll(".settings-nav-item");
    expect(navItems).toHaveLength(5);
    expect(navItems[0].textContent).toBe("General");
    expect(navItems[1].textContent).toBe("Editor");
    expect(navItems[2].textContent).toBe("Preview");
    expect(navItems[3].textContent).toBe("Appearance");
    expect(navItems[4].textContent).toBe("AI");
  });

  it("marks the active section nav item", () => {
    render(<SettingsDialog onClose={onClose} />);
    const navItems = document.querySelectorAll(".settings-nav-item");
    expect(navItems[0].className).toContain("active");
    expect(navItems[1].className).not.toContain("active");
  });

  it("switches to Editor section on click", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Editor"));
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("Tab size")).toBeInTheDocument();
    expect(screen.getByText("Word wrap")).toBeInTheDocument();
  });

  it("switches to Preview section on click", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("Use sidecar preview")).toBeInTheDocument();
    expect(screen.getByText("Default zoom")).toBeInTheDocument();
  });

  it("switches to Appearance section on click", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Appearance"));
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });

  it("switches to AI section on click", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("AI"));
    expect(screen.getByText("Provider")).toBeInTheDocument();
  });

  it("closes when Escape is pressed", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when backdrop is clicked", () => {
    render(<SettingsDialog onClose={onClose} />);
    const backdrop = document.querySelector(".settings-backdrop")!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when dialog body is clicked", () => {
    render(<SettingsDialog onClose={onClose} />);
    const dialog = document.querySelector(".settings-dialog")!;
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when close button is clicked", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toggles confirmOnClose in General section", () => {
    render(<SettingsDialog onClose={onClose} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(useEditorStore.getState().confirmOnClose).toBe(false);
  });

  it("updates fontSize in Editor section", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Editor"));
    const fontSizeInput = screen.getByDisplayValue("14");
    fireEvent.change(fontSizeInput, { target: { value: "18" } });
    expect(useEditorStore.getState().editorFontSize).toBe(18);
  });

  it("toggles wordWrap in Editor section", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Editor"));
    const checkboxes = document.querySelectorAll(".settings-content input[type='checkbox']");
    const wrapCheckbox = checkboxes[0];
    expect(wrapCheckbox).toBeChecked();
    fireEvent.click(wrapCheckbox);
    expect(useEditorStore.getState().editorWordWrap).toBe(false);
  });

  it("toggles theme in Appearance section", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Appearance"));
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "claude" } });
    expect(useEditorStore.getState().theme).toBe("claude");
  });

  it("toggles useSidecarPreview in Preview section", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Preview"));
    const checkbox = document.querySelector(".settings-content input[type='checkbox']")!;
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(useEditorStore.getState().useSidecarPreview).toBe(false);
  });

  it("changes AI provider to ollama and shows ollama fields", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("AI"));
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "ollama" } });
    expect(useEditorStore.getState().aiProvider).toBe("ollama");
    expect(screen.getByText("Ollama server URL")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("shows Claude CLI info when provider is claude-cli", () => {
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("AI"));
    expect(screen.getByText("Claude CLI").closest(".settings-row")).toBeInTheDocument();
    expect(screen.getByText(/npm install -g @anthropic-ai\/claude-code/)).toBeInTheDocument();
  });

  it("fetches ollama models when Refresh is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(["llama3.2", "mistral"]);

    useEditorStore.setState({ aiProvider: "ollama" });
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_ollama_models", { baseUrl: "http://localhost:11434" });
    });
  });

  it("shows error when fetching ollama models fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("connection refused"));

    useEditorStore.setState({ aiProvider: "ollama" });
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      expect(screen.getByText(/Could not connect to Ollama/)).toBeInTheDocument();
    });
  });
});
