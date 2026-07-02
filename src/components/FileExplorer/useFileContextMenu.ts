import { useState, useCallback } from "react";

export function useFileContextMenu() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPosition(null), []);

  return { position, open, close };
}
