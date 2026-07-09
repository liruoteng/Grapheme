import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../stores/editorStore";
import { isTauriRuntime } from "../lib/tauriRuntime";

export function useFilePolling() {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const POLL_MS = 2000;
    let timer: ReturnType<typeof setInterval> | null = null;
    let pending = false;

    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const store = useEditorStore.getState();
        const cleanTabs = store.tabs.filter(
          (t) => !t.isDirty && !t.isTemp && t.path && !t.path.startsWith("__temp__"),
        );
        for (const tab of cleanTabs) {
          try {
            const content = await invoke<string>("read_file", { path: tab.path });
            const current = useEditorStore.getState();
            const currentTab = current.tabs.find((t) => t.path === tab.path);
            if (currentTab && !currentTab.isDirty && content !== currentTab.content) {
              useEditorStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                  t.path === tab.path ? { ...t, content } : t,
                ),
              }));
            }
          } catch {
            // file gone — leave tab open, user can close manually
          }
        }
      } finally {
        pending = false;
      }
    };

    timer = setInterval(poll, POLL_MS);
    return () => { if (timer) clearInterval(timer); };
  }, []);
}
