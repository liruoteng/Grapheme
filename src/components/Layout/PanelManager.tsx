import { useState, useRef, useCallback, Fragment, type Dispatch, type RefObject, type ReactNode, type SetStateAction } from "react";
import { X, Check } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { ALL_PANELS, type PanelId } from "./panelDefinitions";
import "./PanelManager.css";

export type { PanelId };

export interface PanelContents {
  ai:      ReactNode;
  editor:  ReactNode;
  preview: ReactNode;
  diff:    ReactNode;
  outline: ReactNode;
  pdf:     ReactNode;
  bibliography: ReactNode;
  profiler: ReactNode;
}

interface PanelManagerProps {
  contents: PanelContents;
  headerExtras?: Partial<Record<PanelId, ReactNode>>;
  headerExtrasLeft?: Partial<Record<PanelId, ReactNode>>;
  titleSuffixes?: Partial<Record<PanelId, ReactNode>>;
  diffTitle?: string;
}

// ── Drag-to-reorder state ─────────────────────────────────────────────────────
let dragFromIdx = -1;

// ── Individual panel ──────────────────────────────────────────────────────────
interface PanelProps {
  id: PanelId;
  idx: number;
  label: string;
  isTopRight: boolean;
  isSideBySide: boolean;
  dropSide?: "before" | "after";
  dropLayout?: "horizontal" | "vertical";
  titleSuffix?: ReactNode;
  headerExtra?: ReactNode;
  headerExtraLeft?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
  onClose: (idx: number) => void;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver:  (e: React.DragEvent, idx: number) => void;
  onDrop:      (e: React.DragEvent, idx: number) => void;
  onDragEnd:   (e: React.DragEvent) => void;
}

function Panel({ id, idx, label, isTopRight, isSideBySide, titleSuffix, headerExtra, headerExtraLeft,
  dropSide, dropLayout, children, style, onClose, onDragStart, onDragOver, onDrop, onDragEnd }: PanelProps) {
  const diffMode = id === "diff" ? (isSideBySide ? "side by side" : "inline") : undefined;
  const dropClass = dropSide && dropLayout
    ? ` pm-panel--drop-${dropSide} pm-panel--drop-${dropLayout}`
    : "";
  return (
    <div
      className={`pm-panel${dropClass}`}
      data-id={id}
      data-idx={idx}
      style={style}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
    >
      <div
        className="pm-panel-header"
        style={isTopRight ? { paddingRight: 56 } : undefined}
        draggable
        onDragStart={(e) => onDragStart(e, idx)}
        onDragEnd={onDragEnd}
      >
        <div className="pm-panel-header-left">
          {headerExtraLeft}
        </div>
        <span className="pm-panel-title">
          {label}
          {diffMode && <span className="pm-panel-subtitle">{diffMode}</span>}
          {titleSuffix}
        </span>
        <div className="pm-panel-header-right">
          {headerExtra}
          <button className="pm-panel-close" onClick={() => onClose(idx)} title={`Close ${label}`} aria-label={`Close ${label} panel`}>
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="pm-panel-body">{children}</div>
    </div>
  );
}

// ── Resize handles ────────────────────────────────────────────────────────────
interface RowHandleProps {
  topId: string;
  botId: string;
  colRef: RefObject<HTMLDivElement | null>;
  sizeFor: (id: string) => number;
  setPanelSizes: Dispatch<SetStateAction<Record<string, number>>>;
  horizontal?: boolean;
}

function RowHandle({ topId, botId, colRef, sizeFor, setPanelSizes, horizontal = false }: RowHandleProps) {
  const startRef = useRef({ height: 600, top: 1, bottom: 1, total: 2 });
  const onPointerDown = usePointerDrag<HTMLDivElement>({
    bodyClassName: horizontal ? "pm-resizing-col" : "pm-resizing-row",
    onStart: () => {
      const top = sizeFor(topId);
      const bottom = sizeFor(botId);
      startRef.current = {
        height: colRef.current?.getBoundingClientRect().height ?? 600,
        top,
        bottom,
        total: top + bottom,
      };
    },
    onMove: ({ deltaX, deltaY }) => {
      const start = startRef.current;
      const size = horizontal
        ? (colRef.current?.getBoundingClientRect().width ?? 800)
        : start.height;
      const delta = horizontal ? deltaX : deltaY;
      const dy = (delta / size) * start.total;
      setPanelSizes((sizes) => ({
        ...sizes,
        [topId]: Math.max(start.total * 0.05, start.top + dy),
        [botId]: Math.max(start.total * 0.05, start.bottom - dy),
      }));
    },
  });

  return <div className={horizontal ? "pm-col-handle" : "pm-row-handle"} onPointerDown={onPointerDown} />;
}

// ── Panel selector dropdown ───────────────────────────────────────────────────
export interface PanelSelectorProps {
  activePanels: string[];
  onToggle: (id: PanelId) => void;
  onClose: () => void;
}

export function PanelSelector({ activePanels, onToggle, onClose }: PanelSelectorProps) {
  return (
    <div className="pm-selector" onMouseDown={(e) => e.stopPropagation()}>
      <div className="pm-selector-header">Panels</div>
      {ALL_PANELS.map((p) => {
        const active = activePanels.includes(p.id);
        return (
          <button
            key={p.id}
            className={`pm-selector-item${active ? " pm-selector-item--on" : ""}`}
            onClick={() => { onToggle(p.id); onClose(); }}
          >
            <span className={`pm-selector-check${active ? " pm-selector-check--on" : ""}`}>
              {active && <Check size={10} />}
            </span>
            <span className="pm-selector-info">
              <span className="pm-selector-label">{p.label}</span>
              <span className="pm-selector-desc">{p.shortcut}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── PanelManager ──────────────────────────────────────────────────────────────
export function PanelManager({ contents, headerExtras, headerExtrasLeft, titleSuffixes, diffTitle }: PanelManagerProps) {
  const activePanels    = useEditorStore((s) => s.activePanels);
  const setActivePanels = useEditorStore((s) => s.setActivePanels);
  const panelLayout     = useEditorStore((s) => s.panelLayout);
  const setPanelLayout  = useEditorStore((s) => s.setPanelLayout);

  // Panel sizes as flex-grow values, keyed by panel ID (or "__top__" for the two-col section)
  const [panelSizes, setPanelSizes] = useState<Record<string, number>>({});
  const [dropPreview, setDropPreview] = useState<{
    idx: number;
    side: "before" | "after";
    layout: "horizontal" | "vertical";
  } | null>(null);

  const singleColRef = useRef<HTMLDivElement>(null);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    setDropPreview(null);
    const el = (e.currentTarget as HTMLElement).closest(".pm-panel") as HTMLElement | null;
    if (el) setTimeout(() => el.classList.add("pm-panel--dragging"), 0);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragFromIdx < 0 || dragFromIdx === idx) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    
    const edgeX = Math.min(x, w - x) / Math.max(1, w);
    const edgeY = Math.min(y, h - y) / Math.max(1, h);
    const layout = edgeX < 0.28 ? "horizontal" : edgeY < 0.28 ? "vertical" : panelLayout;
    const side = layout === "horizontal"
      ? (x < w / 2 ? "before" : "after")
      : (y < h / 2 ? "before" : "after");
    setDropPreview({ idx, side, layout });
  }, [panelLayout]);

  const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragFromIdx;
    const preview = dropPreview;
    if (from >= 0 && from !== idx && preview) {
      const next = [...activePanels];
      const [moved] = next.splice(from, 1);
      let insertAt = preview.side === "after" ? idx + 1 : idx;
      if (from < insertAt) insertAt -= 1;
      next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved);
      setActivePanels(next);
      setPanelLayout(preview.layout);
    }
    clearDrag(setDropPreview);
  }, [activePanels, dropPreview, setActivePanels, setPanelLayout]);

  const handleDragEnd = useCallback(() => { clearDrag(setDropPreview); }, []);

  const closePanel = useCallback((idx: number) => {
    setActivePanels(activePanels.filter((_, i) => i !== idx));
  }, [activePanels, setActivePanels]);

  // ── Resize helpers ────────────────────────────────────────────────────────
  const sz = (id: string) => Math.max(0.05, panelSizes[id] ?? 1);

  // ── Layout computation ────────────────────────────────────────────────────
  const n       = activePanels.length;
  const isHoriz = panelLayout === "horizontal" && n > 1;

  // ── Panel renderer ────────────────────────────────────────────────────────
  const makePanel = (id: string, globalIdx: number, isTopRight: boolean, isSideBySide: boolean) => {
    const def   = ALL_PANELS.find((p) => p.id === id)!;
    const label = id === "diff" && diffTitle ? `Diff — ${diffTitle}` : def.label;
    return (
      <Panel
        key={id}
        id={id as PanelId}
        idx={globalIdx}
        label={label}
        isTopRight={isTopRight}
        isSideBySide={isSideBySide}
        titleSuffix={titleSuffixes?.[id as PanelId]}
        headerExtra={headerExtras?.[id as PanelId]}
        headerExtraLeft={headerExtrasLeft?.[id as PanelId]}
        onClose={closePanel}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        dropSide={dropPreview?.idx === globalIdx ? dropPreview.side : undefined}
        dropLayout={dropPreview?.idx === globalIdx ? dropPreview.layout : undefined}
        style={{
          flexGrow: sz(id),
          flexShrink: 1,
          flexBasis: 0,
          minHeight: 0,
          minWidth: isHoriz ? 220 : 0,
          overflow: "hidden",
        }}
      >
        <div className="pm-panel-content-wrap" style={{ display: id === "editor" || id === "preview" ? "flex" : undefined }}>
          {contents[id as PanelId]}
        </div>
      </Panel>
    );
  };

  return (
    <div className={`pm-root${n === 1 ? " pm-root--single" : ""}`}>
      <div ref={singleColRef} className={isHoriz ? "pm-flex-row" : "pm-flex-col"}>
        {activePanels.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && (
              <RowHandle
                key={`handle${i}`}
                topId={activePanels[i - 1]}
                botId={id}
                colRef={singleColRef}
                sizeFor={sz}
                setPanelSizes={setPanelSizes}
                horizontal={isHoriz}
              />
            )}
            {makePanel(id, i, isHoriz ? i === n - 1 : i === 0, n === 1)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function clearDrag(setDropPreview?: (preview: null) => void) {
  setDropPreview?.(null);
  document.querySelectorAll<HTMLElement>(".pm-panel--dragging")
    .forEach((el) => el.classList.remove("pm-panel--dragging"));
  dragFromIdx = -1;
}
