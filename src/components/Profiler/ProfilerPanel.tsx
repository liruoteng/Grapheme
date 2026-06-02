import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, Cpu, Clock, Gauge, MemoryStick, Trash2 } from "lucide-react";
import { useEditorStore, useActiveTab } from "../../stores/editorStore";
import {
  clearProfilerMetrics,
  recordProfilerMetric,
  subscribeProfilerMetrics,
  type ProfilerMetric,
} from "../../lib/performanceProfiler";
import "./ProfilerPanel.css";

type BackendMetric = {
  name: string;
  duration_ms?: number;
  value?: number;
  unit?: string;
  detail?: string | null;
  timestamp_ms?: number;
};

type MemoryStats = {
  used: number;
  total: number;
  limit: number;
} | null;

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: Array<{ bytes: number; types: string[] }>;
  }>;
};

function formatMs(ms: number | undefined) {
  if (ms === undefined) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function metricValue(metric: ProfilerMetric) {
  if (metric.durationMs !== undefined) return formatMs(metric.durationMs);
  if (metric.unit === "B" && metric.value !== undefined) return formatBytes(metric.value);
  if (metric.value !== undefined) return `${metric.value.toFixed(metric.value < 10 ? 1 : 0)}${metric.unit ?? ""}`;
  return "n/a";
}

function latestDuration(metrics: ProfilerMetric[], name: string) {
  return [...metrics].reverse().find((metric) => metric.name === name)?.durationMs;
}

export function ProfilerPanel() {
  const [metrics, setMetrics] = useState<ProfilerMetric[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [memory, setMemory] = useState<MemoryStats>(null);
  const [browserMemoryBytes, setBrowserMemoryBytes] = useState<number | null>(null);
  const [threadLoad, setThreadLoad] = useState<number | null>(null);
  const [longTaskCount, setLongTaskCount] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsAtRef = useRef(performance.now());
  const lastThreadSampleAtRef = useRef(performance.now());
  const longTaskMsRef = useRef(0);
  const activeTab = useActiveTab();
  const tabs = useEditorStore((s) => s.tabs);
  const activePanels = useEditorStore((s) => s.activePanels);

  useEffect(() => subscribeProfilerMetrics(setMetrics), []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<BackendMetric>("perf-metric", (event) => {
          const payload = event.payload;
          recordProfilerMetric({
            name: payload.name,
            source: "backend",
            durationMs: payload.duration_ms,
            value: payload.value,
            unit: payload.unit,
            detail: payload.detail ?? undefined,
            timestamp: payload.timestamp_ms,
          });
        })
      )
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      frameCountRef.current += 1;
      const elapsed = now - lastFpsAtRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFpsAtRef.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const readMemory = async () => {
      const mem = (performance as PerformanceWithMemory).memory;
      setMemory(mem ? {
        used: mem.usedJSHeapSize,
        total: mem.totalJSHeapSize,
        limit: mem.jsHeapSizeLimit,
      } : null);

      const measureMemory = (performance as PerformanceWithMemory).measureUserAgentSpecificMemory;
      if (!measureMemory) {
        setBrowserMemoryBytes(mem?.usedJSHeapSize ?? null);
        return;
      }
      try {
        const measured = await measureMemory.call(performance);
        setBrowserMemoryBytes(measured.bytes);
        recordProfilerMetric({
          name: "memory.browser",
          source: "frontend",
          value: measured.bytes,
          unit: "B",
          detail: "Browser-reported page memory",
        });
      } catch {
        setBrowserMemoryBytes(mem?.usedJSHeapSize ?? null);
      }
    };
    readMemory();
    const id = window.setInterval(readMemory, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        setLongTaskCount((count) => count + entries.length);
        longTaskMsRef.current += entries.reduce((sum, entry) => sum + entry.duration, 0);
        for (const entry of entries.slice(-5)) {
          recordProfilerMetric({
            name: "main-thread.long-task",
            source: "frontend",
            durationMs: entry.duration,
            detail: "Browser long task",
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      return () => observer.disconnect();
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const sampleEveryMs = 1000;
    const id = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(1, now - lastThreadSampleAtRef.current);
      const timerDriftMs = Math.max(0, elapsed - sampleEveryMs);
      const longTaskLoad = (longTaskMsRef.current / elapsed) * 100;
      const driftLoad = (timerDriftMs / elapsed) * 100;
      const load = Math.min(100, Math.max(longTaskLoad, driftLoad));

      setThreadLoad(load);
      recordProfilerMetric({
        name: "main-thread.load",
        source: "frontend",
        value: load,
        unit: "%",
        detail: "Estimated from long tasks and timer drift",
      });

      longTaskMsRef.current = 0;
      lastThreadSampleAtRef.current = now;
    }, sampleEveryMs);
    return () => window.clearInterval(id);
  }, []);

  const recentMetrics = useMemo(() => [...metrics].reverse().slice(0, 18), [metrics]);
  const activeDocBytes = activeTab ? new Blob([activeTab.content]).size : 0;
  const backendCount = metrics.filter((metric) => metric.source === "backend").length;
  const latestSave = latestDuration(metrics, "file.save");
  const latestMarkdownWrite = latestDuration(metrics, "preview.markdown-write");
  const latestSidecarStart = latestDuration(metrics, "preview.sidecar-start");

  return (
    <div className="profiler-panel">
      <div className="profiler-summary">
        <ProfilerStat icon={<Gauge size={15} />} label="FPS" value={fps === null ? "warming" : String(fps)} />
        <ProfilerStat
          icon={<Activity size={15} />}
          label="JS heap"
          value={memory ? `${formatBytes(memory.used)} / ${formatBytes(memory.limit)}` : "unavailable"}
        />
        <ProfilerStat
          icon={<MemoryStick size={15} />}
          label="Memory usage"
          value={browserMemoryBytes === null ? "unavailable" : formatBytes(browserMemoryBytes)}
        />
        <ProfilerStat icon={<Clock size={15} />} label="Long tasks" value={String(longTaskCount)} />
        <ProfilerStat
          icon={<Cpu size={15} />}
          label="UI thread load"
          value={threadLoad === null ? "warming" : `${Math.round(threadLoad)}%`}
        />
      </div>

      <div className="profiler-grid">
        <div className="profiler-section">
          <div className="profiler-section-title">Current workload</div>
          <ProfilerRow label="Active document" value={activeTab ? activeTab.name : "None"} />
          <ProfilerRow label="Document size" value={activeTab ? formatBytes(activeDocBytes) : "n/a"} />
          <ProfilerRow label="Open tabs" value={String(tabs.length)} />
          <ProfilerRow label="Open panels" value={activePanels.join(", ") || "None"} />
        </div>

        <div className="profiler-section">
          <div className="profiler-section-title">Latest timings</div>
          <ProfilerRow label="Save" value={formatMs(latestSave)} />
          <ProfilerRow label="Markdown preview write" value={formatMs(latestMarkdownWrite)} />
          <ProfilerRow label="Sidecar start" value={formatMs(latestSidecarStart)} />
          <ProfilerRow label="Backend samples" value={String(backendCount)} />
        </div>
      </div>

      <div className="profiler-history-header">
        <span>Recent samples</span>
        <button className="profiler-clear-btn" type="button" onClick={clearProfilerMetrics} title="Clear profiler samples">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="profiler-history">
        {recentMetrics.length === 0 ? (
          <div className="profiler-empty">No samples yet. Edit, save, preview, or export to collect timings.</div>
        ) : (
          recentMetrics.map((metric) => (
            <div key={metric.id} className="profiler-sample">
              <span className={`profiler-source profiler-source--${metric.source}`}>{metric.source}</span>
              <span className="profiler-name" title={metric.detail}>{metric.name}</span>
              <span className="profiler-value">{metricValue(metric)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProfilerStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="profiler-stat">
      <span className="profiler-stat-icon">{icon}</span>
      <span className="profiler-stat-label">{label}</span>
      <span className="profiler-stat-value">{value}</span>
    </div>
  );
}

function ProfilerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="profiler-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}
