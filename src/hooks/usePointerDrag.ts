import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface PointerDragStart<T extends HTMLElement> {
  event: ReactPointerEvent<T>;
  startX: number;
  startY: number;
}

interface PointerDragMove {
  event: PointerEvent;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

interface UsePointerDragOptions<T extends HTMLElement> {
  bodyClassName?: string;
  cursor?: string;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  onStart?: (drag: PointerDragStart<T>) => void;
  onMove: (drag: PointerDragMove) => void;
  onEnd?: () => void;
}

export function usePointerDrag<T extends HTMLElement>({
  bodyClassName,
  cursor,
  preventDefault = true,
  stopPropagation = false,
  onStart,
  onMove,
  onEnd,
}: UsePointerDragOptions<T>) {
  const optionsRef = useRef({ bodyClassName, cursor, onStart, onMove, onEnd });
  const stateRef = useRef<{ startX: number; startY: number } | null>(null);
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);

  optionsRef.current = { bodyClassName, cursor, onStart, onMove, onEnd };

  const stop = useCallback(() => {
    if (!stateRef.current) return;
    stateRef.current = null;

    const { bodyClassName, onEnd } = optionsRef.current;
    if (bodyClassName) document.body.classList.remove(bodyClassName);
    if (previousBodyStyleRef.current) {
      document.body.style.cursor = previousBodyStyleRef.current.cursor;
      document.body.style.userSelect = previousBodyStyleRef.current.userSelect;
      previousBodyStyleRef.current = null;
    }

    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("blur", stop);
    onEnd?.();
  }, []);

  const move = useCallback((event: PointerEvent) => {
    const state = stateRef.current;
    if (!state) return;
    if (event.buttons === 0) {
      stop();
      return;
    }

    optionsRef.current.onMove({
      event,
      startX: state.startX,
      startY: state.startY,
      deltaX: event.clientX - state.startX,
      deltaY: event.clientY - state.startY,
    });
  }, [stop]);

  const onPointerDown = useCallback((event: ReactPointerEvent<T>) => {
    if (preventDefault) event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const { bodyClassName, cursor, onStart } = optionsRef.current;
    stateRef.current = { startX: event.clientX, startY: event.clientY };
    if (bodyClassName) document.body.classList.add(bodyClassName);
    if (cursor) {
      previousBodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    }

    onStart?.({
      event,
      startX: event.clientX,
      startY: event.clientY,
    });

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
  }, [move, preventDefault, stop, stopPropagation]);

  useEffect(() => stop, [stop]);

  return onPointerDown;
}
