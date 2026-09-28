import type * as Monaco from "monaco-editor";

let loadedMonaco: typeof Monaco | null = null;
const listeners = new Set<() => void>();

export const getLoadedMonaco = () => loadedMonaco;

export function subscribeToMonaco(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Observers must not initialize Monaco before its local loader is configured.
export function registerMonaco(monaco: typeof Monaco) {
  loadedMonaco = monaco;
  for (const listener of listeners) listener();
}
