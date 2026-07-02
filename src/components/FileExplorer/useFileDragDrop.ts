import { useState, useCallback } from "react";
import { getActiveDragSource, getFileDragMime, setActiveDragSource } from "./fileDrag";

function setCustomDragImage(e: React.DragEvent, label: string, isDir: boolean) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  const icon = document.createElement("span");
  icon.className = "drag-ghost-icon";
  icon.textContent = isDir ? "▶" : "·";
  const text = document.createElement("span");
  text.textContent = label;
  ghost.append(icon, text);
  document.body.appendChild(ghost);
  if (typeof e.dataTransfer.setDragImage === "function") {
    e.dataTransfer.setDragImage(ghost, 12, 12);
  }
  setTimeout(() => ghost.remove(), 0);
}

export function useDragSource(path: string, name: string, isDir: boolean) {
  const onDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData(getFileDragMime(), path);
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = isDir ? "move" : "copyMove";
    setCustomDragImage(e, name, isDir);
    setActiveDragSource(path);
  }, [path, name, isDir]);

  const onDragEnd = useCallback(() => {
    setActiveDragSource(null);
  }, []);

  return { onDragStart, onDragEnd };
}

export function useDropTarget(
  onRequestMove: (src: string, destDir: string) => void,
  onOsDrop: (files: FileList, destDir: string) => void,
  dirPath: string,
) {
  const [dropHover, setDropHover] = useState(false);

  const onDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    const activeDragSource = getActiveDragSource();
    if (!activeDragSource && !hasFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = activeDragSource ? "move" : "copy";
    setDropHover(prev => prev ? prev : true);
  }, []);

  const onDragLeave = useCallback(() => setDropHover(false), []);

  const onDrop = useCallback((e: React.DragEvent) => {
    setDropHover(false);
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onOsDrop(e.dataTransfer.files, dirPath);
      return;
    }
    const src = getActiveDragSource() ?? e.dataTransfer.getData(getFileDragMime());
    if (!src) return;
    setActiveDragSource(null);
    onRequestMove(src, dirPath);
  }, [dirPath, onRequestMove, onOsDrop]);

  return { dropHover, onDragOver, onDragLeave, onDrop };
}
