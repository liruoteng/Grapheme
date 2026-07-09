# Repository Health Check — TODO-20260425

> Generated: 2026-06-25
> Project: Grapheme (type-studio) — Tauri + React + Typst desktop writing app

---

## Executive Summary

| Area | Status |
|------|--------|
| Lint (`eslint src`) | **PASS** — zero errors |
| TypeScript (`tsc --noEmit`) | **PASS** — zero errors |
| Unit tests (Vitest, 553 tests, 29 files) | **PASS** — all green |
| Frontend coverage | **28.9% statements / 25% branches / 28.5% functions** — barely above thresholds |
| npm audit | **55 vulnerabilities** (46 low, 6 moderate, 3 high) |
| Outdated dependencies | **46 packages** behind latest |
| Rust code | Clean — no `unsafe`, no `dbg!`, minimal production `unwrap()` |
| Git hygiene | `.gitignore` has a dangerous blanket `*.md` rule |

---

## 1. Security & Vulnerabilities (HIGH PRIORITY)

- [ ] **Fix 3 high-severity npm audit issues**
  - `vite` 7.0.0–7.3.3: `server.fs.deny` bypass on Windows + NTLMv2 hash disclosure via UNC path
  - `undici` 7.0.0–7.27.2: 7 advisories including TLS cert bypass, HTTP header injection, DoS, response queue poisoning
  - Run `npm audit fix` and verify no breaking changes
- [ ] **Review CSP policy** in `tauri.conf.json` — currently allows `'unsafe-inline'` for styles and `connect-src` to `http://localhost:*` (very broad)
- [ ] **Audit asset protocol scope** — `$DOCUMENT/*`, `$APPDATA/*`, `$DESKTOP/*`, `$DOWNLOAD/*` grants wide filesystem read access
- [ ] **Review `opener:allow-open-path`** scoped to `$HOME/**` — verify this is the minimum required scope

---

## 2. Dependency Management (HIGH PRIORITY)

- [ ] **Update `vite` from 7.3.2 → 7.3.6+** (security fix for high-severity advisories)
- [ ] **Update `react` / `react-dom` from 19.2.5 → 19.2.7**
- [ ] **Update `@tauri-apps/api` from 2.10.1 → 2.11.1** and `@tauri-apps/cli` → 2.11.3
- [ ] **Update `vitest` from 4.1.4 → 4.1.9** and `@vitest/coverage-v8` → 4.1.9
- [ ] **Update `tailwindcss` / `@tailwindcss/vite` from 4.2.4 → 4.3.1**
- [ ] **Update `lucide-react` from 0.479.0 → 1.21.0** (major version bump — check breaking changes)
- [ ] **Update `pdfjs-dist` from 5.6.205 → 5.7.284+** (or 6.x with migration)
- [ ] **Update `@milkdown/*` packages from 7.20.0 → 7.21.2** (keep in sync)
- [ ] **Update `@codemirror/*` packages** to latest patch versions
- [ ] **Evaluate major version upgrades** (deferred, require migration effort):
  - `@eslint/js` 9 → 10, `eslint` 9 → 10
  - `eslint-plugin-react-hooks` 5 → 7
  - `@vitejs/plugin-react` 4 → 6
  - `typescript` 5.8 → 6.0
  - `vite` 7 → 8
  - `vscode-languageclient` 9 → 10
  - `katex` 0.16 → 0.17
- [ ] **Version mismatch**: `package.json` says `0.1.0` but `Cargo.toml` and `tauri.conf.json` say `0.0.1` — synchronize

---

## 3. Test Coverage (MEDIUM PRIORITY)

Current frontend coverage is barely above the configured thresholds:

| Metric | Current | Threshold | Headroom |
|--------|---------|-----------|----------|
| Statements | 28.93% | 25% | 3.93% |
| Branches | 24.97% | 20% | 4.97% |
| Functions | 28.51% | 23% | 5.51% |
| Lines | 29.85% | 26% | 3.85% |

### Zero-coverage modules (need tests most):
- [ ] `src/lib/agent/` — **6% coverage** (entire AI agent system: LLM provider, tools, coordinator, query engine)
- [ ] `src/components/PdfViewer/` — **0% coverage** (PDF viewer panel + renderer)
- [ ] `src/components/Preview/` — **0–9% coverage** (preview panel, sidecar)
- [ ] `src/components/Settings/` — **0% coverage** (settings dialog)
- [ ] `src/components/Templates/` — **0% coverage** (template picker)
- [ ] `src/components/Profiler/` — **0% coverage** (profiler panel)
- [ ] `src/stores/paperStore.ts` — **0% coverage** (paper/reference management store)
- [ ] `src/hooks/useLspClient.ts` — **0% coverage** (LSP hook)
- [ ] `src/hooks/usePreview.ts` — **0% coverage** (preview hook)

### Partially covered (improve):
- [ ] `src/components/Layout/StatusBar.tsx` — 55% statements
- [ ] `src/components/Layout/PanelManager.tsx` — 46% statements
- [ ] `src/components/References/ReferencesPanel.tsx` — 43% statements
- [ ] `src/stores/editorStore.ts` — 74% statements (good but branches at 53%)

### Test infrastructure:
- [ ] **Standardize test file placement** — tests are split between `src/` (co-located, 19 files) and `tests/` (top-level, 17 files) with no clear convention. Pick one pattern:
  - Option A: Co-locate all unit tests in `src/`, keep only integration/stress in `tests/`
  - Option B: Move all tests to `tests/` with matching directory structure
- [ ] **Add Rust test coverage** — `cargo test` passes but no coverage metrics are collected
- [ ] **E2E tests** — only 1 spec file (`e2e/app.spec.ts`); expand coverage for critical user flows

---

## 4. Code Quality — Large Files (MEDIUM PRIORITY)

These files are candidates for decomposition:

### TypeScript
- [ ] **`MarkdownWysiwygEditor.tsx` — 4,292 lines** — The largest file by far. Extract:
  - ProseMirror plugin definitions into separate files
  - Image handling logic into a dedicated module
  - Table editing handlers into a dedicated module
  - Slash command handling into a dedicated module
- [ ] **`AIChatPanel.tsx` — 1,207 lines** — Extract message rendering, input handling, and session management
- [ ] **`App.tsx` — 985 lines** — Extract Tauri command handlers, menu setup, and initialization logic
- [ ] **`WritingModeEditor.tsx` — 911 lines** — Extract slash menu, toolbar, and plugin setup
- [ ] **`FileTree.tsx` — 851 lines** — Extract drag-and-drop, context menu, and file operation handlers
- [ ] **`MonacoEditor.tsx` — 831 lines** — Extract LSP integration, image drop, and customization setup

### Rust
- [ ] **`lib.rs` — 2,698 lines** — Decompose into modules:
  - `commands.rs` — Tauri command handlers
  - `compile_actor.rs` — Compile queue and actor
  - `project.rs` — Project creation/management
  - `snapshots.rs` — Version snapshots
  - `menu.rs` — Menu construction
  - `setup.rs` — App setup/initialization
- [ ] **`converter.rs` — 3,095 lines** (~677 production + ~2,418 tests) — Consider splitting conversion logic into sub-modules (frontmatter, blocks, inline, math)
- [ ] **`latex_import/convert.rs` — 1,868 lines** (~1,513 production) — Extract environment handlers, command handlers, and math conversion

---

## 5. Code Quality — Patterns & Practices (MEDIUM PRIORITY)

### Hardcoded values to consolidate:
- [ ] **Ollama URL `http://localhost:11434`** is duplicated in 3 places:
  - `src/stores/editorStore.ts:360`
  - `src/lib/agent/GraphemeLLMProvider.ts:194`
  - `src/components/Settings/SettingsDialog.tsx:234,239`
  - Extract to a single constant (e.g., `DEFAULT_OLLAMA_URL`)
- [ ] **Semantic Scholar API URL** duplicated in:
  - `src/lib/agent/tools/LiteratureSearchTool.ts:44`
  - `src/components/PdfViewer/PDFViewerPanel.tsx:68`
  - Extract to a shared constants file
- [ ] **LSP WebSocket URL `ws://127.0.0.1:8765`** hardcoded in `src/components/Editor/lsp-client.ts:14` — make configurable or at least a constant
- [ ] **PDF.js CDN worker URL** hardcoded in `PDFViewerPanel.tsx:8` — consider bundling the worker

### TypeScript escape hatches:
- [ ] **11 `any` type usages** in ProseMirror contexts (`WritingModeEditor.tsx`, `SelectionToolbar.tsx`) — replace with proper ProseMirror `EditorView` / `Command` types
- [ ] **7 `eslint-disable react-hooks/exhaustive-deps`** — review each for correctness; missing deps can cause stale closures:
  - `WritingModeEditor.tsx:287`
  - `MarkdownWysiwygEditor.tsx:4076`
  - `AIChatPanel.tsx:373`
  - `FileTree.tsx:129`
  - `TableOfContents.tsx:31`
  - `usePreview.ts:32`
  - `PreviewPanel.tsx:42`

### Error handling:
- [ ] **50 `console.error`/`console.warn` calls** across 19 files — consider introducing a structured logger that can be disabled in production and supports log levels
- [ ] **No user-facing error notification system** — errors are only logged to console. Consider toast notifications or an error banner for critical failures

### Rust-specific:
- [ ] **`lib.rs:812` — `rest.chars().next().unwrap()`** — the only risky production `unwrap()`. Replace with proper error handling or `expect()` with a descriptive message
- [ ] **3 `Mutex.lock().unwrap()` calls** in `lib.rs` (lines 471, 1453, 1615, 2494) — consider using `parking_lot::Mutex` which doesn't poison, or handle poison errors gracefully
- [ ] **No shared error type** — all Rust errors are `Result<_, String>`. Introduce a custom error enum (e.g., `AppError`) with variants for IO, Typst, conversion, etc.
- [ ] **No clippy configuration** — add a `[lints]` section to `Cargo.toml` or a `clippy.toml` to enforce lint standards in CI
- [ ] **Add `cargo clippy` to CI** — currently only `cargo test` runs in CI

---

## 6. Git & Repository Hygiene (MEDIUM PRIORITY)

- [ ] **Fix `.gitignore` blanket `*.md` rule (line 47)** — This silently ignores ALL markdown files including:
  - `AGENTS.md` (not tracked!)
  - `plans/markdown-preview-robustness.md` (not tracked!)
  - Any future `CONTRIBUTING.md`, `CHANGELOG.md`, etc.
  - **Fix**: Replace `*.md` with specific ignores like `TODOS.md`, `FUTURE.md`, `CLAUDE.md`, etc.
- [ ] **Untracked modified files** — `git status` shows 5 modified files not staged:
  - `.github/workflows/ci.yml`
  - `eslint.config.js`
  - `src-tauri/src/converter.rs`
  - `src/components/ui/button.tsx`
  - `src/components/ui/tabs.tsx`
  - Decide: commit or discard these changes
- [ ] **Remove `.DS_Store` files on disk** — 4 files exist (though correctly gitignored): root, `src-tauri/`, `src-tauri/src/`, `tests/`
- [ ] **Clean up root-level `.preview.typ` cache files** — 9 files at root (gitignored but clutter the directory listing)
- [ ] **Consider adding a `.gitattributes`** for consistent line endings across platforms (especially relevant since the release workflow builds on Windows, macOS, and Linux)

---

## 7. CI/CD Pipeline (MEDIUM PRIORITY)

- [ ] **Add `cargo clippy` step** to CI — enforce Rust lint checks
- [ ] **Add `cargo fmt --check`** to CI — enforce Rust formatting
- [ ] **Add coverage reporting** to CI — upload frontend coverage to a service (Codecov, Coveralls)
- [ ] **Add Rust coverage metrics** — `cargo tarpaulin` or `cargo llvm-cov`
- [ ] **CI uses `npm ci` but release uses `npm install`** — standardize on `npm ci` for reproducible builds in `release.yml:43`
- [ ] **No caching for Rust builds** in CI — add `Swatinem/rust-cache` action to speed up Rust compilation
- [ ] **Node.js version mismatch**: README says "Node.js 20+" but CI uses exactly `node-version: 20`. Consider testing on Node 22 as well
- [ ] **E2E tests only run Chromium** — consider adding Firefox/WebKit if cross-browser support matters
- [ ] **No build verification step** — add `npm run build` to CI to catch build-time errors
- [ ] **Release workflow**: tinymist download uses `tar -xz --strip-components=1` which assumes a specific archive structure — add error handling

---

## 8. Build & Configuration (LOW PRIORITY)

- [ ] **`vite.config.ts` uses `@ts-expect-error`** for `process.env` (line 6) — use `import.meta.env` or `loadEnv` from Vite instead
- [ ] **`tsconfig.node.json` only includes `vite.config.ts`** — also include `vitest.config.ts`, `vitest.stress.config.ts`, `playwright.config.ts`
- [ ] **Coverage thresholds are very low** (25% statements, 20% branches) — incrementally raise as coverage improves
- [ ] **`release.sh` exists but is gitignored** — either track it or document the release process elsewhere
- [ ] **No `.nvmrc` or `engines` field** in `package.json` — add `"engines": { "node": ">=20" }` to enforce Node version
- [ ] **No `typecheck` script** — add `"typecheck": "tsc --noEmit"` to `package.json` scripts for convenience

---

## 9. Documentation (LOW PRIORITY)

- [ ] **README.md is minimal** (82 lines) — add:
  - Screenshots / GIF of the app
  - Architecture overview (frontend ↔ Tauri ↔ Rust ↔ Typst)
  - Contributing guide
  - Development setup for Windows/Linux (currently macOS-focused)
  - Keyboard shortcuts reference
- [ ] **No CHANGELOG.md** — the release workflow references it (`"See CHANGELOG for details."`) but it doesn't exist
- [ ] **No API documentation** for the Rust Tauri commands
- [ ] **Inline code comments are sparse** — add JSDoc/TSDoc to key public APIs (stores, hooks, lib functions)
- [ ] **`AGENTS.md` is not tracked by git** — force-add it or fix the `.gitignore` rule

---

## 10. Performance & UX Concerns (LOW PRIORITY)

- [ ] **`MarkdownWysiwygEditor.tsx` at 4,292 lines** — likely has performance implications for editor rendering. Profile and consider virtualizing or lazy-loading parts
- [ ] **PDF.js worker loaded from CDN** (`cdnjs.cloudflare.com`) — will fail offline; bundle the worker script
- [ ] **No lazy loading / code splitting** visible in Vite config — consider React.lazy for heavy panels (PDF viewer, AI chat, template picker)
- [ ] **Monaco editor is a heavy dependency** — verify it's only loaded when source mode is active

---

## 11. Miscellaneous

- [ ] **`public/tauri.svg` and `public/vite.svg`** — leftover scaffold files, remove if unused
- [ ] **`skills-lock.json` is gitignored** — verify this is intentional
- [ ] **`src/App.css` exists** — check if it's still used alongside Tailwind CSS
- [ ] **Multiple config files at root** (`.prettierrc`, `eslint.config.js`, `components.json`, `playwright.config.ts`, `vitest.config.ts`, `vitest.stress.config.ts`) — consider consolidating into a `config/` directory for cleanliness
- [ ] **`@types/diff`, `@types/prismjs`, `@types/yaml`** are in `dependencies` instead of `devDependencies` — move to `devDependencies`

---

## Quick Wins (Do First)

1. `npm audit fix` — resolve 55 vulnerabilities
2. Fix `.gitignore` `*.md` blanket rule
3. Sync version: `package.json` `0.1.0` ↔ `Cargo.toml`/`tauri.conf.json` `0.0.1`
4. Add `"typecheck": "tsc --noEmit"` script
5. Add `cargo clippy` + `cargo fmt --check` to CI
6. Move `@types/*` from `dependencies` to `devDependencies`
7. Commit or discard the 5 unstaged modified files
8. Extract hardcoded Ollama URL to a shared constant
