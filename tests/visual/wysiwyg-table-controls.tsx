import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/App.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      convertFileSrc: (filePath: string) => string;
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      transformCallback: (callback: unknown) => number;
      unregisterCallback: (id: number) => void;
    };
  }
}

window.__TAURI_INTERNALS__ = {
  convertFileSrc: (filePath: string) => filePath,
  invoke: async () => null,
  transformCallback: () => Math.floor(Math.random() * 1_000_000),
  unregisterCallback: () => {},
};

const { MarkdownWysiwygEditor } = await import("../../src/components/Editor/MarkdownWysiwygEditor");
const { useEditorStore } = await import("../../src/stores/editorStore");

function TableControlsHarness() {
  useEffect(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useEditorStore.setState({
      editorFontSize: 18,
      editorWidth: 860,
      theme: "dark",
      workspacePath: "/visual",
    });
    useEditorStore.getState().openTab(
      "/visual/table-controls.md",
      "table-controls.md",
      [
        "# Tables",
        "",
        "| Name | Role | Status |",
        "| --- | --- | --- |",
        "| Alice | Engineer | Active |",
        "| Bob | Designer | Active |",
        "| Charlie | Manager | On leave |",
        "",
      ].join("\n"),
    );
  }, []);

  return <MarkdownWysiwygEditor />;
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  body { background: #101415; color: #e8edf0; overflow: hidden; }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(<TableControlsHarness />);
