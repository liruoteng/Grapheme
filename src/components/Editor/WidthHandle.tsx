import { useRef } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import "./WidthHandle.css";

export function WidthHandle() {
  const setEditorWidth = useEditorStore((s) => s.setEditorWidth);
  const startW = useRef(0);

  const onPointerDown = usePointerDrag<HTMLDivElement>({
    cursor: "col-resize",
    stopPropagation: true,
    onStart: () => {
      startW.current = useEditorStore.getState().editorWidth;
    },
    onMove: ({ deltaX }) => {
      setEditorWidth(startW.current + deltaX);
    },
  });

  return <div className="editor-width-handle" onPointerDown={onPointerDown} />;
}
