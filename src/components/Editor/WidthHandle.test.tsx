import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { WidthHandle } from "./WidthHandle";
import { useEditorStore } from "../../stores/editorStore";

beforeEach(() => {
  useEditorStore.setState({ editorWidth: 960 });
});

describe("WidthHandle", () => {
  it("renders a div with editor-width-handle class", () => {
    const { container } = render(<WidthHandle />);
    const handle = container.querySelector(".editor-width-handle");
    expect(handle).toBeInTheDocument();
  });

  it("changes editor width on pointer drag", () => {
    const { container } = render(<WidthHandle />);
    const handle = container.querySelector(".editor-width-handle")!;

    const downEvent = new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 0,
      pointerId: 1,
      bubbles: true,
    });
    const setPointerCapture = vi.fn();
    handle.setPointerCapture = setPointerCapture;
    handle.dispatchEvent(downEvent);

    // Simulate pointermove with buttons=1 (drag)
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 200,
        clientY: 0,
        buttons: 1,
      }),
    );

    expect(useEditorStore.getState().editorWidth).toBe(1060);

    // Cleanup
    window.dispatchEvent(new PointerEvent("pointerup"));
  });
});
