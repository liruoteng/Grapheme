import { describe, expect, it } from "vitest";
import {
  clearProfilerMetrics,
  getProfilerMetrics,
  recordProfilerMetric,
  subscribeProfilerMetrics,
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
});
