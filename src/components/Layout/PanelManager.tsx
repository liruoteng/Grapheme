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
let dragOverIdx = -1;

// ── Individual panel ──────────────────────────────────────────────────────────
interface PanelProps {
  id: PanelId;
  idx: number;
  label: string;
  isTopRight: boolean;
  isSideBySide: boolean;
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
  children, style, onClose, onDragStart, onDragOver, onDrop, onDragEnd }: PanelProps) {
  const diffMode = id === "diff" ? (isSideBySide ? "side by side" : "inline") : undefined;
  return (
    <div
      className="pm-panel"
      data-id={id}
      data-idx={idx}
      style={style}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
    >
      <div
        className="pm-panel-header"
        style={isTopRight ? { paddingRight: 48 } : undefined}
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
}

function RowHandle({ topId, botId, colRef, sizeFor, setPanelSizes }: RowHandleProps) {
  const startRef = useRef({ height: 600, top: 1, bottom: 1, total: 2 });
  const onPointerDown = usePointerDrag<HTMLDivElement>({
    bodyClassName: "pm-resizing-row",
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
    onMove: ({ deltaY }) => {
      const start = startRef.current;
      const dy = (deltaY / start.height) * start.total;
      setPanelSizes((sizes) => ({
        ...sizes,
        [topId]: Math.max(start.total * 0.05, start.top + dy),
        [botId]: Math.max(start.total * 0.05, start.bottom - dy),
      }));
    },
  });

  return <div className="pm-row-handle" onPointerDown={onPointerDown} />;
}

interface ColHandleProps {
  colFr: number;
  rowRef: RefObject<HTMLDivElement | null>;
  setColFr: Dispatch<SetStateAction<number>>;
}

function ColHandle({ colFr, rowRef, setColFr }: ColHandleProps) {
  const startRef = useRef({ width: 800, fraction: 0.5 });
  const onPointerDown = usePointerDrag<HTMLDivElement>({
    bodyClassName: "pm-resizing-col",
    onStart: () => {
      startRef.current = {
        width: rowRef.current?.getBoundingClientRect().width ?? 800,
        fraction: colFr,
      };
    },
    onMove: ({ deltaX }) => {
      const start = startRef.current;
      setColFr(Math.max(0.1, Math.min(0.9, start.fraction + deltaX / start.width)));
    },
  });

  return <div className="pm-col-handle" onPointerDown={onPointerDown} />;
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
  // Fraction [0.1, 0.9] for left column width in horizontal layout
  const [colFr, setColFr] = useState(0.5);

  const outerRef   = useRef<HTMLDivElement>(null);
  const rowRef     = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const singleColRef = useRef<HTMLDivElement>(null);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
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
    
    const isHorizontal = Math.min(x, w - x) < Math.min(y, h - y);

    if (dragOverIdx !== idx) {
      document.querySelectorAll<HTMLElement>(".pm-panel--drop-target")
        .forEach((elem) => {
          elem.classList.remove("pm-panel--drop-target", "pm-panel--drop-horizontal", "pm-panel--drop-vertical");
        });
      const panels = document.querySelectorAll<HTMLElement>(".pm-panel");
      if (panels[idx]) panels[idx].classList.add("pm-panel--drop-target");
      dragOverIdx = idx;
    }
    
    const panels = document.querySelectorAll<HTMLElement>(".pm-panel");
    if (panels[idx]) {
      if (isHorizontal) {
        panels[idx].classList.add("pm-panel--drop-horizontal");
        panels[idx].classList.remove("pm-panel--drop-vertical");
      } else {
        panels[idx].classList.add("pm-panel--drop-vertical");
        panels[idx].classList.remove("pm-panel--drop-horizontal");
      }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const isHorizontal = el.classList.contains("pm-panel--drop-horizontal");

    const from = dragFromIdx;
    if (from >= 0 && from !== idx) {
      const next = [...activePanels];
      [next[from], next[idx]] = [next[idx], next[from]];
      setActivePanels(next);
      setPanelLayout(isHorizontal ? "horizontal" : "vertical");
    }
    clearDrag();
  }, [activePanels, setActivePanels, setPanelLayout]);

  const handleDragEnd = useCallback(() => { clearDrag(); }, []);

  const closePanel = useCallback((idx: number) => {
    setActivePanels(activePanels.filter((_, i) => i !== idx));
  }, [activePanels, setActivePanels]);

  // ── Resize helpers ────────────────────────────────────────────────────────
  const sz = (id: string) => Math.max(0.05, panelSizes[id] ?? 1);

  // ── Layout computation ────────────────────────────────────────────────────
  const n       = activePanels.length;
  const isHoriz = panelLayout === "horizontal" && n > 1;
  const hasWide = isHoriz && n % 2 === 1 && n >= 3;

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
        style={{ flexGrow: sz(id), flexShrink: 1, flexBasis: 0, minHeight: 0, overflow: "hidden" }}
      >
        <div className="pm-panel-content-wrap" style={{ display: id === "editor" || id === "preview" ? "flex" : undefined }}>
          {contents[id as PanelId]}
        </div>
      </Panel>
    );
  };

  // ── Single-column layout (vertical mode, or n=1) ──────────────────────────
  if (!isHoriz) {
    return (
      <div className="pm-root">
        <div ref={singleColRef} className="pm-flex-col">
          {activePanels.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && (
                <RowHandle
                  key={`h${i}`}
                  topId={activePanels[i - 1]}
                  botId={id}
                  colRef={singleColRef}
                  sizeFor={sz}
                  setPanelSizes={setPanelSizes}
                />
              )}
              {makePanel(id, i, i === 0, n === 1)}
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  // ── Horizontal layout ─────────────────────────────────────────────────────
  const mainCount = hasWide ? n - 1 : n;
  const leftIds   = activePanels.slice(0, mainCount).filter((_, i) => i % 2 === 0);
  const rightIds  = activePanels.slice(0, mainCount).filter((_, i) => i % 2 === 1);
  const wideId    = hasWide ? activePanels[n - 1] : null;

  return (
    <div className="pm-root">
      <div ref={outerRef} className="pm-flex-col">
        {/* Two-column section */}
        <div
          ref={rowRef}
          className="pm-flex-row"
          style={{ flexGrow: sz("__top__"), flexShrink: 1, flexBasis: 0, minHeight: 0 }}
        >
          {/* Left column */}
          <div ref={leftColRef} className="pm-flex-col" style={{ flex: `${colFr} 1 0`, minWidth: 0, overflow: "hidden" }}>
            {leftIds.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && (
                  <RowHandle
                    key={`lh${i}`}
                    topId={leftIds[i - 1]}
                    botId={id}
                    colRef={leftColRef}
                    sizeFor={sz}
                    setPanelSizes={setPanelSizes}
                  />
                )}
                {makePanel(id, activePanels.indexOf(id), false, false)}
              </Fragment>
            ))}
          </div>

          {/* Column resize handle */}
          <ColHandle colFr={colFr} rowRef={rowRef} setColFr={setColFr} />

          {/* Right column */}
          <div ref={rightColRef} className="pm-flex-col" style={{ flex: `${1 - colFr} 1 0`, minWidth: 0, overflow: "hidden" }}>
            {rightIds.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && (
                  <RowHandle
                    key={`rh${i}`}
                    topId={rightIds[i - 1]}
                    botId={id}
                    colRef={rightColRef}
                    sizeFor={sz}
                    setPanelSizes={setPanelSizes}
                  />
                )}
                {makePanel(id, activePanels.indexOf(id), i === 0, false)}
              </Fragment>
            ))}
          </div>
        </div>

        {/* Wide panel at bottom (n=3 or n=5) */}
        {wideId && (
          <Fragment key={wideId}>
            <RowHandle topId="__top__" botId={wideId} colRef={outerRef} sizeFor={sz} setPanelSizes={setPanelSizes} />
            {makePanel(wideId, activePanels.indexOf(wideId), false, true)}
          </Fragment>
        )}
      </div>
    </div>
  );
}

function clearDrag() {
  document.querySelectorAll<HTMLElement>(".pm-panel--dragging")
    .forEach((el) => el.classList.remove("pm-panel--dragging"));
  document.querySelectorAll<HTMLElement>(".pm-panel--drop-target")
    .forEach((el) => el.classList.remove("pm-panel--drop-target", "pm-panel--drop-horizontal", "pm-panel--drop-vertical"));
  dragFromIdx = -1;
  dragOverIdx = -1;
}
