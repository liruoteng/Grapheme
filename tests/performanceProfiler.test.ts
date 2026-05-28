import { describe, expect, it, vi } from "vitest";
import {
  clearProfilerMetrics,
  getProfilerMetrics,
  markProfilerDuration,
  recordProfilerMetric,
  subscribeProfilerMetrics,
  timeProfiler,
} from "../src/lib/performanceProfiler";

describe("performanceProfiler", () => {
  it("records bounded metrics and notifies subscribers", () => {
    clearProfilerMetrics();
    const seen: number[] = [];
    const unsubscribe = subscribeProfilerMetrics((metrics) => seen.push(metrics.length));

    recordProfilerMetric({ name: "test.metric", source: "frontend", durationMs: 12 });

    unsubscribe();
    expect(getProfilerMetrics()).toMatchObject([
      { name: "test.metric", source: "frontend", durationMs: 12 },
    ]);
    expect(seen).toEqual([0, 1]);
  });

  it("clears collected metrics", () => {
    clearProfilerMetrics();
    recordProfilerMetric({ name: "test.metric", source: "backend", value: 60, unit: "fps" });

    clearProfilerMetrics();

    expect(getProfilerMetrics()).toEqual([]);
  });

  it("markProfilerDuration records duration", () => {
    clearProfilerMetrics();
    const start = performance.now() - 10;
    markProfilerDuration("test.duration", start);
    const metrics = getProfilerMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].name).toBe("test.duration");
    expect(metrics[0].source).toBe("frontend");
    expect(metrics[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("markProfilerDuration with optional detail", () => {
    clearProfilerMetrics();
    const start = performance.now() - 5;
    markProfilerDuration("test.detail", start, "some detail");
    const metrics = getProfilerMetrics();
    expect(metrics[0].detail).toBe("some detail");
  });

  it("timeProfiler wraps async function and records duration", async () => {
    clearProfilerMetrics();
    const result = await timeProfiler("test.async", async () => "hello");
    expect(result).toBe("hello");
    const metrics = getProfilerMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].name).toBe("test.async");
    expect(metrics[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("timeProfiler records duration even on rejection", async () => {
    clearProfilerMetrics();
    await expect(
      timeProfiler("test.error", async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
    const metrics = getProfilerMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].name).toBe("test.error");
  });

  it("subscribeProfilerMetrics returns unsubscribe function", () => {
    clearProfilerMetrics();
    const fn = vi.fn();
    const unsubscribe = subscribeProfilerMetrics(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    recordProfilerMetric({ name: "test", source: "frontend" });
    expect(fn).toHaveBeenCalledTimes(2);
    unsubscribe();
    recordProfilerMetric({ name: "test2", source: "frontend" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("bounded to maxMetrics entries", () => {
    clearProfilerMetrics();
    for (let i = 0; i < 250; i++) {
      recordProfilerMetric({ name: `metric-${i}`, source: "frontend" });
    }
    expect(getProfilerMetrics()).toHaveLength(240);
    expect(getProfilerMetrics()[0].name).toBe("metric-10");
  });
});
