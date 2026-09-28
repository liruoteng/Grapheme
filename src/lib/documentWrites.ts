import { invoke } from "@tauri-apps/api/core";

const pendingWrites = new Map<string, Promise<void>>();

/** Preserve save order per document while allowing separate files to save concurrently. */
export function writeDocument(path: string, contents: string): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => invoke<void>("write_file", { path, contents }));
  pendingWrites.set(path, next);
  const clear = () => { if (pendingWrites.get(path) === next) pendingWrites.delete(path); };
  void next.then(clear, clear);
  return next;
}
