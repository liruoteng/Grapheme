# TypeStudio Review To-Do

Audit date: 2026-08-05  
Scope: repository inspection plus available frontend/Rust checks. Completed items retain their evidence for traceability.

## Priority 1 — address before the next release

### [P1] ✅ Make sidecar preview compatible with the application CSP

- **Evidence:** `src-tauri/tauri.conf.json:24` sets `frame-src 'none'`, while `src/components/Preview/SidecarPreviewPanel.tsx:124-128` embeds the URL returned by `start_sidecar_preview` in an iframe. The same CSP also permits localhost connections, suggesting the iframe is intended to be used.
- **User impact:** the desktop sidecar preview can be blocked by WebView CSP and remain stuck on the loading state or show a blank panel.
- **Suggested fix:** choose an explicit, narrow frame source for the sidecar server (or serve the preview through a Tauri-controlled origin), then add a desktop smoke test that starts the sidecar and asserts the iframe loads.
- **Completion note (2026-08-05):** `frame-src` now allows only `'self'` and the loopback origin used by `tinymist` (`http://127.0.0.1:*`). Added a Rust regression test that parses `tauri.conf.json`; the existing `SidecarPreviewPanel` smoke test continues to assert the returned loopback URL is placed in the iframe.

### [P1] Restrict filesystem commands to approved workspace/user-selected roots

- **Evidence:** `src-tauri/src/commands.rs:44-73, 98-127, 199-246, 265-275` exposes read, write, create, rename, copy, and delete commands whose paths are accepted directly; the commands are all registered in `src-tauri/src/lib.rs:101-131`. `src-tauri/capabilities/default.json:11-13` also grants opener access to `$HOME/**`, and the asset scope covers multiple broad user directories.
- **User impact/security:** a compromised or unexpectedly modified renderer could read or overwrite arbitrary user files, not just the open workspace. Accidental file operations also have a large blast radius.
- **Suggested fix:** maintain validated workspace roots in backend state, canonicalize and check every path (including rename/copy destinations), require an explicit user-selected path for operations outside the workspace, and narrow capability/asset scopes to the minimum needed.
- **Completion note (2026-08-06):** Added backend `PathPolicy` checks for custom filesystem, preview, export, snapshot, import, and project commands. Workspace roots are canonicalized; temp files remain confined to the app temp directory; native-dialog-selected files/directories are explicitly approved; symlink escapes are rejected. Frontend folder/file/template/import/save flows now register the corresponding root or selected path. Focused path-policy tests cover workspace rejection and symlink escape.

### [P1] Make saves crash-safe and serialize concurrent writes

- **Evidence:** `src-tauri/src/commands.rs:53-60` uses `fs::write` directly, and `src/App.tsx:265-275` invokes it from the editor save path. `src/components/Editor/MonacoEditor.tsx:674-683` schedules Typst autosave with `autoSaveMs = 0`.
- **User impact:** an interrupted write can leave a document truncated, while rapid edits can queue overlapping full-file writes; a crash or filesystem error can lose the last saved version even though the UI marks it clean only after the write returns.
- **Suggested fix:** write to a same-directory temporary file, flush/sync as appropriate, atomically rename it into place, and coalesce/serialize saves per path. Keep the dirty state until the durable operation succeeds.

### [P1] Fix UTF-8 unsafe result truncation in file search

- **Evidence:** `src-tauri/src/commands.rs:175-181` truncates a matching line with `&line[..200]`. Rust string indices must be on UTF-8 character boundaries; a multibyte character crossing byte 200 will panic the command.
- **User impact:** searching a workspace can fail or terminate the command for otherwise valid non-ASCII content (common in papers and multilingual notes).
- **Suggested fix:** truncate by `char_indices()`/`chars()` or use a Unicode-safe boundary, and add a regression test with CJK/emoji text positioned around the limit.

## Priority 2 — important reliability, security, and UX debt

### [P2] ✅ Sanitize SVG before injecting preview markup

- **Evidence:** `src/components/Preview/PreviewPanel.tsx:72-78, 143-151` assigns generated SVG strings to `innerHTML`. The strings ultimately come from the preview/conversion pipeline and may include content derived from user-authored documents or assets.
- **User impact/security:** malformed or unexpectedly rich SVG can introduce active markup or expensive DOM content in the application renderer; it also makes the preview a trust boundary that is currently implicit.
- **Suggested fix:** sanitize/allowlist SVG elements and attributes before insertion, or render through a safer SVG/document boundary. Add tests for scripts, event attributes, external references, and oversized SVG.
- **Completion note (2026-08-06):** Added `sanitizeSvg` allowlisting for preview elements/attributes, local fragment/data-image URLs, and inert style content. Both page and thumbnail injection sites now sanitize first; focused tests cover safe markup, active elements, handlers, external URLs, and embedded images.

### [P2] Make conflict dialogs cross-platform and normalize their result

- **Evidence:** `src-tauri/src/commands.rs:204-231` shells out to macOS-only `osascript`; `src/components/FileExplorer/useFileOperations.ts:35-38` assumes exact `Replace`/`Keep Both` strings.
- **User impact:** move conflicts on Windows/Linux fall back to `Stop`, and small output-format differences can incorrectly cancel a valid move.
- **Suggested fix:** use Tauri’s dialog plugin (or platform-specific implementations) with a typed enum result; test replace, duplicate, and cancel behavior on each supported OS.

### [P2] Avoid full-file disk writes on every Typst keystroke

- **Evidence:** `src/components/Editor/MonacoEditor.tsx:659-671, 674-683` triggers preview immediately for Typst and sets the autosave delay to zero.
- **User impact/performance:** large documents can cause sustained disk I/O, preview watcher churn, UI lag, and more opportunities for save races while typing.
- **Suggested fix:** debounce writes and preview separately (with a short preview debounce and a longer save debounce), cancel stale work, and measure behavior on large documents.

### [P2] Validate template manifest paths and copy nested template content

- **Evidence:** `src-tauri/src/project.rs:259-309` uses the manifest’s `main` value directly in `dest.join(&main_file)` and copies each entry with `fs::copy`; nested directories are not recursively copied. The universe entrypoint is joined at `project.rs:87-94` without validating the entrypoint itself.
- **User impact/reliability:** a template containing assets/subdirectories can fail or produce an incomplete project; malformed manifest/package metadata can resolve outside the intended destination.
- **Suggested fix:** validate manifest and entrypoint paths as single safe relative paths, recursively copy directories, and add tests for nested assets plus traversal attempts.

### [P2] Replace icon-only title hints with robust accessible names and keyboard semantics

- **Evidence:** icon-only toolbar controls at `src/components/Layout/Toolbar.tsx:73-142` and several sidebar controls at `src/components/Layout/FloatingSidebar.tsx:256-275` rely on `title` without `aria-label`; directory rows at `src/components/FileExplorer/FileTree.tsx:179-195` are clickable `<div>` elements rather than keyboard-operable controls.
- **User impact:** screen-reader users may get weak or missing names, and keyboard-only users cannot reliably navigate/toggle the file tree or its drag/drop actions.
- **Suggested fix:** add explicit accessible names, use buttons/tree roles with `tabIndex` and keyboard handlers, expose expanded/selected state, and add automated accessibility checks for the main shell and explorer.

### [P2] Remove or implement the non-functional Profile control

- **Evidence:** `src/components/Layout/FloatingSidebar.tsx:284-287` renders a button labeled “Profile” with a “coming soon” title but no click handler or disabled state.
- **User impact:** users can activate a control that has no effect, which makes the product feel broken and is confusing to assistive technology users.
- **Suggested fix:** either wire it to the intended workflow or render it as non-interactive “Coming soon” status until the feature exists.

## Priority 3 — test and maintainability follow-ups

### [P3] Add end-to-end coverage for critical desktop workflows

- **Evidence:** `e2e/app.spec.ts:3-12` only checks the title and body visibility. It does not exercise open/save, autosave failure, preview startup, Markdown conversion, PDF export, file operations, or unsaved-tab close behavior.
- **User impact:** the highest-risk workflows can regress while the current E2E suite remains green; the existing plan also notes the missing real sidecar/Tauri smoke test in `plans/markdown-preview-robustness.md`.
- **Suggested fix:** add a small cross-platform smoke matrix for open/edit/save/restore, Markdown preview fallback, sidecar load, and export; keep backend-heavy cases in Rust integration tests where possible.

### [P3] Raise and target frontend coverage around untested integration surfaces

- **Evidence:** `vitest.config.ts:18-33` sets low global thresholds (25% statements, 20% branches, 23% functions, 26% lines), while the heaviest integration components include `MarkdownWysiwygEditor.tsx` (4,355 lines), `AIChatPanel.tsx` (1,207), and `App.tsx` (818). The available tests are predominantly unit/store tests.
- **User impact:** editor lifecycle, sidecar coordination, error recovery, accessibility, and AI cancellation paths can fail without detection.
- **Suggested fix:** add focused behavior tests around save/preview race handling, cancellation/unmount cleanup, keyboard navigation, and error states; raise thresholds incrementally after those paths are covered.

### [P3] Split oversized editor/application modules before adding more features

- **Evidence:** `src/components/Editor/MarkdownWysiwygEditor.tsx` is 4,355 lines, with DOM/plugin/table/image handlers mixed into the React component; `src/App.tsx` combines app setup, file lifecycle, export, snapshots, and menu handling.
- **User impact:** changes are difficult to review and test, increasing regression risk and making cleanup of event listeners/timers harder.
- **Suggested fix:** extract ProseMirror plugins and NodeViews, preview/save orchestration, and Tauri menu/file handlers into separately testable modules with explicit lifecycle ownership.

## Verification record

- Passed: `cargo test --manifest-path src-tauri/Cargo.toml` — 183 tests.
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`.
- Passed: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- Not run: frontend typecheck, lint, and Vitest because `node_modules` is absent (`tsc`, `eslint`, and `vitest` were not found).
- Not verified: `npm audit --omit=dev`; the registry request failed with DNS/network resolution (`ENOTFOUND registry.npmjs.org`).
- Not verified: real Tauri/WebView, sidecar, multi-platform dialog behavior, and accessibility with assistive technology.
