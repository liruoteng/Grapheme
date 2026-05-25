const DRAG_MIME = "application/x-type-studio-path";

// WebKit hides custom MIME types from `dataTransfer.types` during dragover/drop,
// so we track the active in-explorer drag source here instead.
let activeDragSource: string | null = null;

export function getFileDragMime(): string {
  return DRAG_MIME;
}

export function getActiveDragSource(): string | null {
  return activeDragSource;
}

export function setActiveDragSource(path: string | null) {
  activeDragSource = path;
}
