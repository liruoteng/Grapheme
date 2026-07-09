type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export function isTauriRuntime() {
  if (import.meta.env.MODE === "test") return true;
  return typeof window !== "undefined" && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}
