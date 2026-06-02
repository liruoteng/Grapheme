import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useEditorStore, type Tab } from "../../stores/editorStore";
import { ContextMenu } from "./ContextMenu";
import "./TabBar.css";

export function TabBar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const confirmOnClose = useEditorStore((s) => s.confirmOnClose);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const focusTabAt = useCallback((index: number) => {
    const tabElements = Array.from(document.querySelectorAll<HTMLElement>(".tab-bar [role='tab']"));
    tabElements[index]?.focus();
  }, []);

  const handleTabKeyDown = useCallback((event: React.KeyboardEvent, index: number, path: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveTab(path);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + offset + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex].path);
    requestAnimationFrame(() => focusTabAt(nextIndex));
  }, [focusTabAt, setActiveTab, tabs]);

  const shouldConfirmClose = useCallback((t: Tab) => {
    if (t.isTemp && t.content !== "") {
      // Non-blocking reminder: the file is kept on disk in the OS temp dir.
      console.info(`Reminder: "${t.name}" is still in temp at ${t.path}. Save it (Cmd+S) to keep it permanently.`);
      return true;
    }
    if (confirmOnClose && t.isDirty) return confirm(`Close "${t.name}" without saving?`);
    return true;
  }, [confirmOnClose]);

  const closeAllTabs = useCallback(() => {
    const { tabs: current } = useEditorStore.getState();
    for (const t of current) {
      if (shouldConfirmClose(t)) useEditorStore.getState().closeTab(t.path);
    }
  }, [shouldConfirmClose]);

  const closeOtherTabs = useCallback((keepPath: string) => {
    const { tabs: current } = useEditorStore.getState();
    for (const t of current) {
      if (t.path === keepPath) continue;
      if (shouldConfirmClose(t)) useEditorStore.getState().closeTab(t.path);
    }
  }, [shouldConfirmClose]);

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="tab-bar" role="tablist" aria-label="Open files">
        {tabs.map((tab, index) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={activeTabPath === tab.path}
            tabIndex={activeTabPath === tab.path ? 0 : -1}
            className={`tab ${activeTabPath === tab.path ? "active" : ""}`}
            onClick={() => setActiveTab(tab.path)}
            onKeyDown={(e) => handleTabKeyDown(e, index, tab.path)}
            onContextMenu={(e) => handleContextMenu(e, tab.path)}
          >
            <span className="tab-name">{tab.name}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                if (!shouldConfirmClose(tab)) return;
                closeTab(tab.path);
              }}
              title="Close tab"
              aria-label={`Close ${tab.name}`}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: "Close Tab",
              action: () => {
                const tab = tabs.find((t) => t.path === ctxMenu.path);
                if (tab && !shouldConfirmClose(tab)) return;
                closeTab(ctxMenu.path);
              },
            },
            {
              label: "Close Other Tabs",
              action: () => closeOtherTabs(ctxMenu.path),
              disabled: tabs.length <= 1,
            },
            {
              label: "Close All Tabs",
              action: closeAllTabs,
            },
            { separator: true },
            {
              label: "Copy Path",
              action: () => navigator.clipboard.writeText(ctxMenu.path),
            },
          ]}
        />
      )}
    </>
  );
}
