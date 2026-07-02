import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import { logger } from "../../lib/logger";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { FileTree, type FileTreeHandle } from "../FileExplorer/FileTree";
import "./FloatingSidebar.css";

interface SearchMatch {
  path: string;
  line: number;
  line_content: string;
}

interface FloatingSidebarProps {
  onOpenFolder: () => void;
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 13.5c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="7" y1="1" x2="7" y2="2.5"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="7" y1="11.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="1" y1="7" x2="2.5" y2="7"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="11.5" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="2.93" y1="2.93" x2="4"    y2="4"    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="10"   y1="10"   x2="11.07" y2="11.07" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="2.93" y1="11.07" x2="4"    y2="10"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="10"   y1="4"     x2="11.07" y2="2.93" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M11.5 9A5.5 5.5 0 0 1 5 2.5a5.5 5.5 0 1 0 6.5 6.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function FloatingSidebar({ onOpenFolder }: FloatingSidebarProps) {
  const sidebarOpen    = useEditorStore((s) => s.sidebarOpen);
  const setSidebarOpen = useEditorStore((s) => s.setSidebarOpen);
  const theme          = useEditorStore((s) => s.theme);
  const setTheme       = useEditorStore((s) => s.setTheme);
  const tabs           = useEditorStore((s) => s.tabs);
  const setActiveTab   = useEditorStore((s) => s.setActiveTab);
  const workspacePath  = useEditorStore((s) => s.workspacePath);
  const openTab        = useEditorStore((s) => s.openTab);
  const setScrollToLine = useEditorStore((s) => s.setScrollToLine);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const widthRef = useRef(220);
  const resizeStartWidthRef = useRef(220);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback(() => setSidebarOpen(!sidebarOpen), [sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    const offset = sidebarOpen ? sidebarWidth + 16 : 56;
    document.documentElement.style.setProperty("--fsb-content-offset", `${offset}px`);
    return () => {
      document.documentElement.style.removeProperty("--fsb-content-offset");
    };
  }, [sidebarOpen, sidebarWidth]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || !workspacePath) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await invoke<SearchMatch[]>("search_in_files", {
          rootDir: workspacePath,
          query: searchQuery.trim(),
        });
        setSearchResults(results);
      } catch (e) {
        logger.error("search error", e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, workspacePath]);

  const openSearchResult = useCallback(
    async (match: SearchMatch) => {
      const name = match.path.split("/").pop() || match.path.split("\\").pop() || match.path;
      const path = match.path;
      // Only open if not already open
      const existing = tabs.find((t) => t.path === path);
      if (!existing) {
        try {
          const content = await invoke<string>("read_file", { path });
          openTab(path, name, content);
        } catch (e) {
          logger.error("read_file error", e);
          return;
        }
      } else {
        setActiveTab(path);
      }
      setScrollToLine(match.line);
    },
    [tabs, openTab, setActiveTab, setScrollToLine],
  );

  const handleSearchToggle = useCallback(() => {
    const next = !searchOpen;
    setSearchOpen(next);
    if (next) {
      // Focus input on next tick after render
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setSearchQuery("");
      setSearchResults([]);
    }
  }, [searchOpen]);

  const asideRef = useRef<HTMLElement>(null);

  const handleResizePointerDown = usePointerDrag<HTMLDivElement>({
    cursor: "col-resize",
    onStart: () => {
      resizeStartWidthRef.current = widthRef.current;
      asideRef.current?.classList.add("fsb--resizing");
    },
    onMove: ({ deltaX }) => {
      const startWidth = resizeStartWidthRef.current;
      const w = Math.max(140, Math.min(520, startWidth + deltaX));
      widthRef.current = w;
      setSidebarWidth(w);
    },
    onEnd: () => {
      asideRef.current?.classList.remove("fsb--resizing");
    },
  });

  return (
    <aside
      ref={asideRef}
      className={`fsb${sidebarOpen ? " fsb--open" : ""}`}
      style={sidebarOpen ? { width: sidebarWidth } : undefined}
      aria-label="Sidebar"
    >
      {/* ── Top bar: brand + actions ──────────────────────────── */}
      <div className="fsb-topbar">
        <span className="fsb-brand">Grapheme</span>
        <div className="fsb-topbar-actions">
          {sidebarOpen && (
            <button
              className={`fsb-topbar-btn${searchOpen ? " fsb-topbar-btn--active" : ""}`}
              onClick={handleSearchToggle}
              title="Search in files"
              aria-label="Search in files"
            >
              <SearchIcon />
            </button>
          )}
          <button
            className="fsb-topbar-btn"
            onClick={toggle}
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-label="Toggle sidebar"
          >
            <SidebarIcon />
          </button>
        </div>
      </div>

      {/* ── Search section ──────────────────────────────────────── */}
      {sidebarOpen && searchOpen && (
        <SearchSection
          query={searchQuery}
          onQueryChange={setSearchQuery}
          results={searchResults}
          searching={searching}
          onSelectResult={openSearchResult}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
            setSearchResults([]);
          }}
          inputRef={searchInputRef}
        />
      )}

      {/* ── Section 1: File Explorer (fills remaining height) ── */}
      <div className="fsb-section fsb-section--grow">
        <div className="fsb-section-head">
          <span className="fsb-section-title">Explorer</span>
          <div className="fsb-section-actions" style={{ display: 'flex', gap: '4px' }}>
            <button
              className="fsb-section-action"
              title="New file"
              onClick={() => fileTreeRef.current?.newFile()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              className="fsb-section-action"
              title="New folder"
              onClick={() => fileTreeRef.current?.newFolder()}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M1 3C1 2.44772 1.44772 2 2 2H6L7.5 4H14C14.5523 4 15 4.44772 15 5V13C15 13.5523 14.5523 14 14 14H2C1.44772 14 1 13.5523 1 13V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="fsb-explorer-body">
          <FileTree ref={fileTreeRef} onOpenFolder={onOpenFolder} />
        </div>
      </div>

      {/* ── Bottom: profile + theme ──────────────────────────── */}
      <div className="fsb-bottom">
        <button className="fsb-bottom-btn" title="Profile (coming soon)" aria-label="User profile">
          <UserIcon />
          <span className="fsb-bottom-label">Profile</span>
        </button>
        <button
          className="fsb-bottom-btn"
          onClick={() => setTheme(theme === "dark" ? "claude" : "dark")}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span className="fsb-bottom-label">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </div>

      {/* ── Resize handle (right edge, only when open) ───────── */}
      {sidebarOpen && (
        <div className="fsb-resize-handle" onPointerDown={handleResizePointerDown} />
      )}
    </aside>
  );
}

// ── Search Section ──────────────────────────────────────────────────────────
interface SearchSectionProps {
  query: string;
  onQueryChange: (v: string) => void;
  results: SearchMatch[];
  searching: boolean;
  onSelectResult: (match: SearchMatch) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function SearchSection({
  query,
  onQueryChange,
  results,
  searching,
  onSelectResult,
  onClose,
  inputRef,
}: SearchSectionProps) {
  // Group results by file path
  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const r of results) {
      const arr = map.get(r.path);
      if (arr) arr.push(r);
      else map.set(r.path, [r]);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <div className="fsb-section fsb-search-section">
      <div className="fsb-search-header">
        <input
          ref={inputRef}
          className="fsb-search-input"
          type="text"
          placeholder="Search in files…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
        <button className="fsb-search-close" onClick={onClose} aria-label="Close search">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="fsb-search-results">
        {searching && (
          <div className="fsb-search-status">Searching…</div>
        )}
        {!searching && query && results.length === 0 && (
          <div className="fsb-search-status">No results</div>
        )}
        {!query && (
          <div className="fsb-search-status">Type to search file contents</div>
        )}
        {grouped.map(([filePath, matches]) => (
          <div key={filePath} className="fsb-search-file-group">
            <div className="fsb-search-file-path" title={filePath}>
              {filePath}
            </div>
            {matches.map((m, i) => (
              <button
                key={`${m.line}-${i}`}
                className="fsb-search-result-row"
                onClick={() => onSelectResult(m)}
              >
                <span className="fsb-search-line-num">{m.line}</span>
                <span className="fsb-search-line-content">{m.line_content}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
