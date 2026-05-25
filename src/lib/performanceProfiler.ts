export type ProfilerMetric = {
  id: number;
  name: string;
  source: "frontend" | "backend";
  timestamp: number;
  durationMs?: number;
  value?: number;
  unit?: string;
  detail?: string;
};

export type ProfilerMetricInput = Omit<ProfilerMetric, "id" | "timestamp"> & {
  timestamp?: number;
};

const maxMetrics = 240;
let nextId = 1;
let metrics: ProfilerMetric[] = [];
const listeners = new Set<(next: ProfilerMetric[]) => void>();

function publish() {
  const snapshot = metrics.slice();
  for (const listener of listeners) listener(snapshot);
}

export function recordProfilerMetric(input: ProfilerMetricInput) {
  const metric: ProfilerMetric = {
    ...input,
    id: nextId++,
    timestamp: input.timestamp ?? Date.now(),
  };
  metrics = [...metrics.slice(Math.max(0, metrics.length - maxMetrics + 1)), metric];
  publish();
}

export function markProfilerDuration(name: string, startedAt: number, detail?: string) {
  recordProfilerMetric({
    name,
    source: "frontend",
    durationMs: Math.max(0, performance.now() - startedAt),
    detail,
  });
}

export async function timeProfiler<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: string,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    markProfilerDuration(name, startedAt, detail);
  }
}

export function getProfilerMetrics() {
  return metrics.slice();
}

export function clearProfilerMetrics() {
  metrics = [];
  publish();
}

export function subscribeProfilerMetrics(listener: (next: ProfilerMetric[]) => void) {
  listeners.add(listener);
  listener(metrics.slice());
  return () => {
    listeners.delete(listener);
  };
}
