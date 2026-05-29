import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryPanel } from "./HistoryPanel";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_snapshots") return Promise.resolve([]);
    if (cmd === "read_file") return Promise.resolve("sample content");
    return Promise.resolve(null);
  });
});

describe("HistoryPanel", () => {
  const defaultProps = (overrides = {}) => ({
    filePath: "/work/doc.typ",
    currentContent: "# Hello\n\nWorld",
    onRestore: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  });

  it("renders header and loading indicator", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<HistoryPanel {...defaultProps()} />);
    expect(screen.getByText("File History")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows empty state when no snapshots", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    await waitFor(() => {
      expect(screen.getByText(/No snapshots yet/)).toBeInTheDocument();
    });
  });

  it("renders snapshot entries", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/1.typ" },
        ]);
      if (cmd === "read_file") return Promise.resolve("old content");
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps({ onClose })} />);
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    const closeBtn = document.querySelector(".history-close-btn") as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("enters compare mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/1.typ" },
        ]);
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Compare"));
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("exits compare mode on cancel", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/1.typ" },
        ]);
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Compare"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("previews snapshot content", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/old.typ" },
        ]);
      if (cmd === "read_file") return Promise.resolve("old content");
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();

    const snapshotBtn = document.querySelectorAll(".history-entry")[1] as HTMLElement;
    fireEvent.click(snapshotBtn);

    expect(await screen.findByText("old content")).toBeInTheDocument();
  });

  it("renders DiffView for snapshot vs current", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/old.typ" },
        ]);
      if (cmd === "read_file") return Promise.resolve("old content");
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();

    const snapshotBtn = document.querySelectorAll(".history-entry")[1] as HTMLElement;
    fireEvent.click(snapshotBtn);
    await screen.findByText("old content");

    fireEvent.click(screen.getByText("Diff with current"));
    expect(await screen.findByText("Content")).toBeInTheDocument();
  });

  it("deselects snapshot on second click", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/old.typ" },
        ]);
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps()} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();

    const snapshotBtn = document.querySelectorAll(".history-entry")[1] as HTMLElement;
    fireEvent.click(snapshotBtn);
    fireEvent.click(snapshotBtn);

    expect(screen.getByText(/Select a version/)).toBeInTheDocument();
  });

  it("restore button calls onRestore then onClose", async () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([
          { timestamp: 1000, path: "/snap/old.typ" },
        ]);
      if (cmd === "read_file") return Promise.resolve("old content");
      return Promise.resolve(null);
    });
    render(<HistoryPanel {...defaultProps({ onRestore, onClose })} />);
    expect(await screen.findByText("Current version")).toBeInTheDocument();

    const snapshotBtn = document.querySelectorAll(".history-entry")[1] as HTMLElement;
    fireEvent.click(snapshotBtn);
    await screen.findByText("old content");

    fireEvent.click(screen.getByText(/Restore this version/));
    expect(onRestore).toHaveBeenCalledWith("old content");
    expect(onClose).toHaveBeenCalled();
  });
});
