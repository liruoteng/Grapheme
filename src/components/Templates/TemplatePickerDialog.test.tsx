import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatePickerDialog } from "./TemplatePickerDialog";

const mockTemplates = [
  {
    id: "ieee-conference",
    name: "IEEE Conference",
    description: "IEEE conference paper",
    category: "Conference",
    main: "main.typ",
  },
  {
    id: "simple-report",
    name: "Simple Report",
    description: "A simple report template",
    category: "General",
    main: "main.typ",
  },
  {
    id: "cv-modern",
    name: "Modern CV",
    description: "Modern curriculum vitae",
    category: "CV / AI",
    main: "main.typ",
  },
];

const mockUniverseTemplates = [
  {
    id: "fancy-template",
    name: "Fancy Template",
    description: "A fancy universe template",
    category: "General",
    main: "main.typ",
    version: "0.1.0",
  },
];

const onClose = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

beforeEach(async () => {
  onClose.mockClear();
  vi.restoreAllMocks();
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "list_templates") return Promise.resolve(mockTemplates);
    if (cmd === "list_universe_templates") return Promise.resolve(mockUniverseTemplates);
    return Promise.resolve(null);
  });
});

describe("TemplatePickerDialog", () => {
  it("renders the dialog title", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    expect(screen.getByText("New Project from Template")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    expect(screen.getByText("Loading templates…")).toBeInTheDocument();
  });

  it("shows templates after loading", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    expect(screen.getByText("Simple Report")).toBeInTheDocument();
    expect(screen.getByText("Modern CV")).toBeInTheDocument();
  });

  it("renders Built-in and Typst Universe source tabs", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Typst Universe")).toBeInTheDocument();
  });

  it("Built-in tab is selected by default", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    const builtInTab = screen.getByRole("tab", { name: "Built-in" });
    expect(builtInTab.getAttribute("aria-selected")).toBe("true");
  });

  it("switches to Typst Universe source", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Typst Universe" }));
    await waitFor(() => {
      expect(screen.getByText("Fancy Template")).toBeInTheDocument();
    });
  });

  it("shows category filters", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Conference" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
  });

  it("filters templates by category", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Conference" }));
    expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    expect(screen.queryByText("Simple Report")).not.toBeInTheDocument();
  });

  it("filters templates by search query", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText("Search templates");
    fireEvent.change(searchInput, { target: { value: "report" } });
    expect(screen.queryByText("IEEE Conference")).not.toBeInTheDocument();
    expect(screen.getByText("Simple Report")).toBeInTheDocument();
  });

  it("shows no matching templates message when search has no results", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText("Search templates");
    fireEvent.change(searchInput, { target: { value: "zzzznonexistent" } });
    expect(screen.getByText("No matching templates.")).toBeInTheDocument();
  });

  it("selects a template on click", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Simple Report").closest(".template-card")!);
    const simpleCard = screen.getByText("Simple Report").closest(".template-card")!;
    expect(simpleCard.className).toContain("selected");
  });

  it("closes when Escape is pressed", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when backdrop is clicked", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    const backdrop = document.querySelector(".template-backdrop")!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when dialog body is clicked", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    const dialog = document.querySelector(".template-dialog")!;
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when Cancel button is clicked", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has default project name 'my-paper'", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    const input = screen.getByDisplayValue("my-paper");
    expect(input).toBeInTheDocument();
  });

  it("allows changing project name", () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    const input = screen.getByDisplayValue("my-paper");
    fireEvent.change(input, { target: { value: "new-project" } });
    expect(screen.getByDisplayValue("new-project")).toBeInTheDocument();
  });

  it("create button is disabled when project name is empty", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    const input = screen.getByDisplayValue("my-paper");
    fireEvent.change(input, { target: { value: "" } });
    const createBtn = screen.getByText("Choose Location…");
    expect(createBtn).toBeDisabled();
  });

  it("shows error when loading templates fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.reject(new Error("load failed"));
      return Promise.resolve(null);
    });
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText(/Error/)).toBeInTheDocument();
    });
  });

  it("shows 'No templates found' when template list is empty", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("No templates found.")).toBeInTheDocument();
    });
  });

  it("renders template badges with category text", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    const badges = document.querySelectorAll(".template-badge");
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain("Conference");
    expect(badgeTexts).toContain("General");
  });

  it("shows version for universe templates", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Typst Universe" }));
    await waitFor(() => {
      expect(screen.getByText("Fancy Template")).toBeInTheDocument();
    });
    expect(screen.getByText("@preview/fancy-template:0.1.0")).toBeInTheDocument();
  });

  it("resets category to All when switching source", async () => {
    render(<TemplatePickerDialog onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("IEEE Conference")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Conference" }));
    fireEvent.click(screen.getByRole("tab", { name: "Typst Universe" }));
    await waitFor(() => {
      expect(screen.getByText("Fancy Template")).toBeInTheDocument();
    });
    const allTab = screen.getByRole("tab", { name: "All" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
  });
});
