import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfilerPanel } from "./ProfilerPanel";
import { useEditorStore } from "../../stores/editorStore";
import {
  recordProfilerMetric,
  clearProfilerMetrics,
} from "../../lib/performanceProfiler";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

beforeEach(() => {
  clearProfilerMetrics();
  useEditorStore.setState({
    tabs: [],
    activeTabPath: null,
    activePanels: [],
  });
});

describe("ProfilerPanel", () => {
  it("renders the panel with summary stats", () => {
    render(<ProfilerPanel />);
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("JS heap")).toBeInTheDocument();
    expect(screen.getByText("Memory usage")).toBeInTheDocument();
    expect(screen.getByText("Long tasks")).toBeInTheDocument();
    expect(screen.getByText("UI thread load")).toBeInTheDocument();
  });

  it("shows 'warming' for FPS initially", () => {
    render(<ProfilerPanel />);
    const warmings = screen.getAllByText("warming");
    expect(warmings.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'unavailable' for memory when not available", () => {
    render(<ProfilerPanel />);
    const unavailables = screen.getAllByText("unavailable");
    expect(unavailables.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Current workload section", () => {
    render(<ProfilerPanel />);
    expect(screen.getByText("Current workload")).toBeInTheDocument();
    expect(screen.getByText("Active document")).toBeInTheDocument();
    expect(screen.getByText("Document size")).toBeInTheDocument();
    expect(screen.getByText("Open tabs")).toBeInTheDocument();
    expect(screen.getByText("Open panels")).toBeInTheDocument();
  });

  it("renders Latest timings section", () => {
    render(<ProfilerPanel />);
    expect(screen.getByText("Latest timings")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Markdown preview write")).toBeInTheDocument();
    expect(screen.getByText("Sidecar start")).toBeInTheDocument();
    expect(screen.getByText("Backend samples")).toBeInTheDocument();
  });

  it("shows 'None' for active document when no tab is open", () => {
    render(<ProfilerPanel />);
    const rows = document.querySelectorAll(".profiler-row");
    const activeDocRow = Array.from(rows).find((r) =>
      r.textContent?.includes("Active document"),
    );
    expect(activeDocRow?.textContent).toContain("None");
  });

  it("shows active document name when a tab is open", () => {
    useEditorStore.getState().openTab("/test.typ", "test.typ", "content");
    render(<ProfilerPanel />);
    expect(screen.getByText("test.typ")).toBeInTheDocument();
  });

  it("shows open tab count", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "");
    render(<ProfilerPanel />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows 'None' for open panels when no panels active", () => {
    render(<ProfilerPanel />);
    const rows = document.querySelectorAll(".profiler-row");
    const panelsRow = Array.from(rows).find((r) =>
      r.textContent?.includes("Open panels"),
    );
    expect(panelsRow?.textContent).toContain("None");
  });

  it("shows active panels", () => {
    useEditorStore.setState({ activePanels: ["editor", "preview"] });
    render(<ProfilerPanel />);
    expect(screen.getByText("editor, preview")).toBeInTheDocument();
  });

  it("shows 'n/a' for timings when no metrics recorded", () => {
    render(<ProfilerPanel />);
    const saveRow = Array.from(document.querySelectorAll(".profiler-row")).find(
      (r) => r.textContent?.includes("Save"),
    );
    expect(saveRow?.textContent).toContain("n/a");
  });

  it("shows empty state message when no samples", () => {
    render(<ProfilerPanel />);
    expect(
      screen.getByText("No samples yet. Edit, save, preview, or export to collect timings."),
    ).toBeInTheDocument();
  });

  it("shows recent samples after recording metrics", () => {
    recordProfilerMetric({
      name: "file.save",
      source: "frontend",
      durationMs: 42,
      detail: "Saved file",
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("file.save")).toBeInTheDocument();
    const msElements = screen.getAllByText("42ms");
    expect(msElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows source badge for each sample", () => {
    recordProfilerMetric({
      name: "compile",
      source: "backend",
      durationMs: 100,
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("clear button calls clearProfilerMetrics", () => {
    recordProfilerMetric({
      name: "test.metric",
      source: "frontend",
      value: 5,
      unit: "ms",
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("test.metric")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Clear profiler samples"));
    expect(
      screen.getByText("No samples yet. Edit, save, preview, or export to collect timings."),
    ).toBeInTheDocument();
  });

  it("shows 'Recent samples' header", () => {
    render(<ProfilerPanel />);
    expect(screen.getByText("Recent samples")).toBeInTheDocument();
  });

  it("shows backend samples count", () => {
    recordProfilerMetric({
      name: "backend.op",
      source: "backend",
      durationMs: 10,
    });
    render(<ProfilerPanel />);
    const backendRow = Array.from(document.querySelectorAll(".profiler-row")).find(
      (r) => r.textContent?.includes("Backend samples"),
    );
    expect(backendRow?.textContent).toContain("1");
  });

  it("formats bytes correctly for memory metrics", () => {
    recordProfilerMetric({
      name: "memory.heap",
      source: "frontend",
      value: 50 * 1024 * 1024,
      unit: "B",
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("50.0MB")).toBeInTheDocument();
  });

  it("formats small values with one decimal", () => {
    recordProfilerMetric({
      name: "cpu.load",
      source: "frontend",
      value: 3.5,
      unit: "%",
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("3.5%")).toBeInTheDocument();
  });

  it("formats large values without decimal", () => {
    recordProfilerMetric({
      name: "count.ops",
      source: "frontend",
      value: 120,
      unit: "ops",
    });
    render(<ProfilerPanel />);
    expect(screen.getByText("120ops")).toBeInTheDocument();
  });
});
