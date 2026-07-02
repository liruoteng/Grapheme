type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const enabled = import.meta.env.VITE_LOG_LEVEL !== "none";
const minLevel: LogLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || "debug";

function shouldLog(level: LogLevel): boolean {
  return enabled && LEVELS[level] >= LEVELS[minLevel];
}

function createLogger(namespace?: string) {
  const prefix = namespace ? `[${namespace}]` : "";

  return {
    debug(...args: unknown[]) {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info(...args: unknown[]) {
      if (shouldLog("info")) console.info(prefix, ...args);
    },
    warn(...args: unknown[]) {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error(...args: unknown[]) {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}

export const logger = createLogger();
export function createNamespacedLogger(ns: string) {
  return createLogger(ns);
}
export type Logger = ReturnType<typeof createLogger>;
