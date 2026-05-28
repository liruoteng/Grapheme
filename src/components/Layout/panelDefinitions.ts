export type PanelId = "editor" | "preview" | "diff" | "outline" | "ai" | "pdf" | "bibliography" | "profiler";

interface PanelDef {
  id: PanelId;
  label: string;
  shortcut: string;
}

export const ALL_PANELS: PanelDef[] = [
  { id: "ai", label: "Grapheme AI", shortcut: "⌘1" },
  { id: "editor", label: "Editor", shortcut: "⌘2" },
  { id: "preview", label: "Preview", shortcut: "⌘3" },
  { id: "diff", label: "Diff", shortcut: "⌘4" },
  { id: "outline", label: "Outline", shortcut: "⌘5" },
  { id: "pdf", label: "PDF Viewer", shortcut: "⌘6" },
  { id: "bibliography", label: "Bibliography", shortcut: "⌘7" },
  { id: "profiler", label: "Performance", shortcut: "⌘8" },
];
