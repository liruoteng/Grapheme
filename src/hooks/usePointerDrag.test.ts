import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePointerDrag } from "./usePointerDrag";

describe("usePointerDrag", () => {
  it("returns a function", () => {
    const { result } = renderHook(() =>
      usePointerDrag({ onMove: vi.fn() }),
    );
    expect(typeof result.current).toBe("function");
  });

  it("calls onStart and onMove on pointer events", () => {
    const onStart = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onStart, onMove }),
    );

    const downEvent = new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      bubbles: true,
    });
    const target = document.createElement("div");
    const setPointerCapture = vi.fn();
    target.setPointerCapture = setPointerCapture;
    target.dispatchEvent(downEvent);

    result.current({
      currentTarget: target,
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ startX: 100, startY: 200 }),
    );

    const moveEvent = new PointerEvent("pointermove", {
      clientX: 150,
      clientY: 250,
      buttons: 1,
    });
    window.dispatchEvent(moveEvent);

    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ deltaX: 50, deltaY: 50 }),
    );
  });

  it("calls onEnd on pointerup", () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, onEnd }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(onEnd).toHaveBeenCalled();
  });

  it("calls onEnd on pointercancel", () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, onEnd }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(new PointerEvent("pointercancel"));
    expect(onEnd).toHaveBeenCalled();
  });

  it("calls onEnd on window blur", () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, onEnd }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(new Event("blur"));
    expect(onEnd).toHaveBeenCalled();
  });

  it("stops drag when buttons become 0 during move", () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, onEnd }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10, buttons: 0 }),
    );
    expect(onEnd).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("adds body class name when bodyClassName is provided", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, bodyClassName: "dragging" }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    expect(document.body.classList.contains("dragging")).toBe(true);

    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(document.body.classList.contains("dragging")).toBe(false);
  });

  it("sets cursor on body when cursor option provided", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      usePointerDrag({ onMove, cursor: "ew-resize" }),
    );

    result.current({
      currentTarget: document.createElement("div"),
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);

    expect(document.body.style.cursor).toBe("ew-resize");
    expect(document.body.style.userSelect).toBe("none");

    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});
