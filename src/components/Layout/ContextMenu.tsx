import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: true;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position so menu stays on screen, then make visible
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${y - rect.height}px`;
    el.style.visibility = "visible";
    el.querySelector<HTMLButtonElement>(".context-menu-item:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".context-menu-item:not(:disabled)") ?? []);
      if (buttons.length === 0) return;
      e.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const offset = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + offset + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y, visibility: "hidden" }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            className="context-menu-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { item.action?.(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
