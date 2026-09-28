# Editor, agent, security, and performance review

Reviewed the current checkout of Grapheme on 2026-09-28. The older repository health report was rechecked against the actual code and dependency lockfile. Existing changes to PanelManager, its tests, PDF panel styling, and the preexisting Monaco test file were preserved.

## Fixed findings

### Markdown and document saving

- Prevented a tab switch from copying the newly active document into the previous editor instance.
- Flushed pending saves and preview updates on editor teardown, including switching tabs or editor modes.
- Kept disk refreshes clean and cancelled obsolete pending writes, avoiding unnecessary saves of externally refreshed content.
- Serialized saves per document. An older save completing cannot mark newer unsaved edits clean.
- Preserved editor font and code-line settings when the view is recreated; fixed the initial cursor for frontmatter-only documents.
- Kept delayed image insertions tied to their original document and mapped insertion position.
- Restricted document links to HTTP, HTTPS, and mailto URLs.
- Fixed incremental decoration replacement: overlapping rebuilds accumulated duplicate widgets. The regression fixture now keeps its decoration count stable across repeated edits.

### Chat and writing agents

- Associated streamed text, status updates, and persistence with the originating conversation. Switching chats cannot redirect a late response into the new chat.
- Prevented overlapping chat requests and the no-workspace session-creation loop.
- Applied Act edits only when the original document and contents still match; otherwise retained the proposal in chat. Cancelled responses cannot apply edits.
- Batched streamed text once per animation frame and memoized completed Markdown messages.
- Fixed an infinite loop when rendering incomplete Markdown block syntax in streamed messages.
- Preserved visible history when starting a fork without a native provider resume ID.
- Used separate persistence queues for each workspace, validated stored conversations, and prevented late disk loads from replacing active conversations.
- Supplied the active draft even without an open workspace. Bounded automatic context discovery to 100 directories, 5,000 entries, 250 files, depth six, and 45,000 content characters; skipped hidden and credential-named files unless explicitly selected. Native context reads are byte-limited.
- Fixed provider/model routing, failures before the first chunk, idle cancellation, and cancellation while awaiting tool approval.
- Preserved native tool-call IDs and results across provider turns. Buffered fragmented Unicode and JSON until complete, and surfaced incomplete or failed streams.
- Replaced text-marker tool dispatch with structured native events. Text quoting a tool call stays text.
- Enforced read-only agent restrictions and inherited denials; cancelled approvals cannot execute a tool.
- Scoped section, citation, and outline state by paper. Updated phase instructions, available tools, and permissions when a paper changes, and prevented old results from entering a new paper's history.

### Native security and dependencies

- Replaced renderer-controlled path approval with native picker grants or an explicit native confirmation. Removed blanket home-directory opener access and broad asset scopes.
- Restricted generated chat-history, snapshot, preview, and export paths to their document directories, including checks for existing symlinks. Search/copy no longer follow directory symlinks; dangling links cannot escape the write policy.
- Required a trusted application Origin before starting a language-server connection and cleaned up its subprocess and forwarding tasks on disconnect.
- Preserved Codex's read-only sandbox on resume, validated stored CLI session IDs, terminated positional options before prompts, and disabled Claude CLI tools, MCP servers, slash commands, and hooks for writing responses.
- Reduced the content security policy's external script/font and broad localhost allowances. Inline styles remain necessary for editor rendering; the preview still uses a dynamic loopback frame port.
- Updated vulnerable dependencies, including PDF.js and Monaco, and removed unused language-client packages. The current npm audit reports **zero vulnerabilities**, down from the verified baseline of **61 (9 high, 52 moderate)**.
- Updated the documented Node requirement to **22.13 or newer** and CI/release builds to Node 22 for the updated dependencies.

### Loading and performance

- Lazy-loaded Markdown, Monaco, and the separate PDF viewer.
- Bundled Monaco and its workers locally. Replaced the status bar's eager Monaco initialization, which otherwise started a CDN request before local configuration was ready.
- Chromium checks verify source editing with external HTTP requests blocked and preservation of Markdown across rich/source mode changes.
- Production main JavaScript chunk: **2,376.09 kB → 390.20 kB**, approximately **84% smaller**. Gzip: **779.12 kB → 127.19 kB**. These are emitted entry-chunk sizes, not measured startup time or total application download size.
- Editor dependencies remain substantial when first opened: Markdown approximately 1,502 kB and Monaco approximately 4,076 kB before gzip. They load on demand.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and production build | Pass |
| Frontend lint | Pass |
| Frontend tests, with coverage | 869 passed, 56 files |
| Frontend stress tests | 5 passed, 3 files |
| Chromium browser tests | 4 passed |
| Rust library tests | 199 passed |
| Rust formatting | Pass |
| Rust Clippy, warnings denied | Pass |
| npm audit | 0 reported vulnerabilities |
| Diff whitespace checks | Pass |

Frontend coverage is **46.02% statements, 40.79% branches, 49.50% functions, and 47.28% lines**, exceeding all configured thresholds. Coverage for `src/lib/agent` is **90.52% statements**. The starting checkout had 806 frontend tests and 185 Rust tests.

## Verification limits and remaining work

- Live paid Claude/Codex/API conversations and a real Ollama server were not exercised. Provider tests use controlled streams, native parsing tests, and installed CLI help to check argument support.
- Native file-picker confirmations, packaged WebView CSP behavior, LSP Origin behavior, and PDF rendering still need a packaged desktop smoke test on macOS, Windows, and Linux. The browser tests run Chromium against the development server.
- npm audit covers the npm dependency graph. A Rust advisory scan and Rust coverage measurement were not performed.
- Canonical-path checks reject existing symlink escapes; they do not provide OS-level protection against a hostile local process concurrently replacing paths between validation and file access.
- Hybrid Markdown `compile:` targets are confined to the Markdown document directory. Absolute targets and parent-directory traversal fall back to standalone Markdown preview.
- PDF/preview UI coverage remains low. Large editor-module decomposition and further reduction of the on-demand editor bundles remain worthwhile follow-up work.
- Broad major-version migrations unrelated to the demonstrated fixes were left for separate compatibility work. No releases or deployments were created.

Reference checked for the PDF.js upgrade: [PDF.js advisory GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j). Native tool-fragment handling was checked against [Anthropic's fine-grained tool streaming documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming).
