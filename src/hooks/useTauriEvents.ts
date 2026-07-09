import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useEditorStore } from "../stores/editorStore";
import { isTauriRuntime } from "../lib/tauriRuntime";

export function useTauriEvents() {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisten1 = listen<{ total_pages: number; updates: { index: number; svg: string }[] }>("preview-result", (e) => {
      const { applyPreviewUpdate, setLastCompileMs, setPreviewLoading, compileStartedAt } = useEditorStore.getState();
      if (compileStartedAt !== null) setLastCompileMs(performance.now() - compileStartedAt);
      applyPreviewUpdate(e.payload.total_pages, e.payload.updates);
      setPreviewLoading(false);
    });
    const unlisten2 = listen<{ message: string }>("preview-error", (e) => {
      const { setPreviewError } = useEditorStore.getState();
      setPreviewError(e.payload.message);
      toast.error("Compile error", { description: e.payload.message.slice(0, 200) });
    });
    const unlistenWarnings = listen<string[]>("converter-warnings", (e) => {
      useEditorStore.getState().setConverterWarnings(e.payload);
    });
    const unlistenGeneratedFile = listen<{ path: string; content: string }>("generated-file-updated", (e) => {
      useEditorStore.getState().syncCleanTabContent(e.payload.path, e.payload.content);
    });
    const unlisten3 = listen("menu:toggle-sidecar-preview", () => {
      const { useSidecarPreview, setUseSidecarPreview } = useEditorStore.getState();
      setUseSidecarPreview(!useSidecarPreview);
    });
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlistenWarnings.then((f) => f());
      unlistenGeneratedFile.then((f) => f());
      unlisten3.then((f) => f());
    };
  }, []);
}
