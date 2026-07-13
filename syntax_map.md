# TODO — Codebase Audit

## Critical

- [x] Add restrictive CSP to `tauri.conf.json` (currently `null`)
- [x] Validate/scope all filesystem paths in Tauri commands to opened project directory
- [x] Fix path traversal in `create_temp_file` — sanitize `extension` parameter
- [x] Fix path traversal in LaTeX `\input` expansion — reject absolute paths
- [x] Narrow asset protocol scope from `$HOME/*` to project directory only
- [x] Fix orphan `ollama serve` process — kill on app exit
- [x] Add React Error Boundaries around each panel

## High — Memory Leaks

- [x] Clean up auto-save/LSP timers on unmount in `MonacoEditor.tsx`
- [x] Clean up auto-save timer on unmount in `WritingModeEditor.tsx`
- [x] Resolve/reject LSP pending requests on WebSocket disconnect
- [x] Reset `AbortController` after interrupt in `QueryEngine.ts`
- [x] Clean up module-level singletons in agent tools (OutlineTool, SectionDraftTool, CitationTool)

## High — Performance

- [x] Optimize `buildMarkdownDecorations` — avoid full-document regex on every keystroke (deferred — viewport-only decorations broke lower-document rendering)
- [x] Avoid full editor recreation on font size change in `MarkdownWysiwygEditor.tsx`
- [x] Fix `activeTab()` selector pattern — causes re-renders on every store change (7 components)
- [x] Replace `Map` with plain object in `paperStore` Zustand state
- [ ] Split monolithic `editorStore` into focused slices (deferred — major refactor)

## High — Race Conditions

- [x] Make `closeTab`/`openTab`/`openTempTab` atomic in `editorStore` (use functional `set`)
- [x] Combine `markTabClean` dual state updates into single atomic `set`
- [x] Fix external content sync race in `MonacoEditor.tsx` (stale seq dependency)
- [x] Fix external content sync race in `MarkdownWysiwygEditor.tsx` (stale seq dependency)
- [x] Fix LSP completion/hover provider race (apply results to disposed model)
- [x] Gate LSP server notifications behind initialization completion
- [ ] Fix `usePreview` race condition — sequence or cancel concurrent invokes (deferred — involves debounce)

## Medium — UX Inconsistencies

- [ ] Unify preview debounce timing (0ms / 200ms / 500ms across editors)
- [ ] Unify auto-save timing (0ms for `.typ` vs 1500ms elsewhere)
- [ ] Consolidate two frontmatter UIs into one
- [ ] Consolidate two PDF viewers into one
- [x] Unify code block language lists (29 vs 45 languages)
- [ ] Unify error display strategy (replace `alert()`, `confirm()`, `window.prompt()`)
- [x] Wire `confirmOnClose` setting into `TabBar.shouldConfirmClose`

## Medium — Accessibility

- [x] Add ARIA roles to SlashMenu, SelectionToolbar, ContextMenu, TabBar, citation menus
- [x] Add keyboard navigation to context menus, tab bar, slash menus
- [ ] Add focus traps to modal dialogs (Settings, Template, History)
- [ ] Replace `window.prompt()` with proper UI dialogs (3 places)
- [ ] Add platform-aware shortcut labels (Ctrl on Windows/Linux)

## Medium — Error Handling

- [ ] Add timeout to AI streaming requests
- [ ] Surface AI errors instead of silently swallowing (GraphemeLLMProvider)
- [ ] Preserve partial AI response on streaming error
- [ ] Handle clipboard API errors in 6 places
- [ ] Replace mutex `.unwrap()` with proper error handling in Rust (7 places)

## Medium — Dead Code

- [x] Remove `frontmatterView.ts` (never imported)
- [ ] Remove or connect PaperEngine/QueryEngine/tools subsystem (~500 lines unused)
- [x] Remove `ReferencesSection` and `MediaSection` behind `false` flags
- [ ] Remove dead CSS classes in `PanelManager.css`

## Low — Type Safety

- [ ] Replace `ctx: any` casts in WritingModeEditor (9 instances)
- [ ] Replace unsafe `as unknown as` casts with proper types
- [ ] Align `AiMessage.role` with agent `MessageRole`

## Low — Configuration

- [ ] Add `.env` file pattern for build-time config
- [ ] Fix `tsc` build to use `-b` flag for project references
- [ ] Include config files in tsconfig (playwright, vitest, eslint)
- [ ] Raise coverage thresholds above 25%

## Low — CSS/Styling

- [ ] Standardize on Tailwind or plain CSS (not both)
- [ ] Define z-index scale
- [ ] Define border-radius scale
- [ ] Define transition duration scale
- [ ] Replace hardcoded colors with CSS variables
