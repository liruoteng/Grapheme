# Grapheme

A desktop AI-powered writing app for [Typst](https://typst.app) and Markdown. (Fun fact: "grapheme" originally meant "the smallest unit of language" - we're literally giving your words a fresh start!)




## Highlight Feature Introduction

### AI-assisted writing and research flow
Use the built-in AI chat panel to plan and structure your paper, generate research outlines, and get real-time assistance with writing and editing. Supports Claude CLI and Ollama.

### Content focusing
Focus on writing content in Markdown. The template and Typst rendering automatically handle all formatting decisions, so you don't need to worry about layout or presentation.

### Bibliography management
Manage your paper's references easily with built-in support for PDFs, `.bib` entries, and citation keys. The references panel keeps everything organized and ready for citation.

### Figure Maker
Create and edit graphs, diagrams, and other visual elements directly in the app for research papers, engineering documentation, and more. Draw flowcharts, diagrams, and other figures with ease.

## Features

- **Dual editors** — Monaco (source mode with Typst syntax highlighting) or Markdown (WYSIWYG for Markdown). Supports Typst (`.typ`) and Markdown (`.md`); Markdown is transparently converted to Typst for live preview.
- **Live PDF preview** — Edit on the left, see the rendered PDF on the right. Toggle with **View → Toggle Sidecar Preview** (`⌘⇧P`).
- **LSP support** — Diagnostics, hover info, autocompletion, and go-to-definition via tinymist, bridged through WebSocket.
- **File management** — Tab-based editing, file tree explorer (create / rename / delete), workspace folders, and file watchers for external changes.
- **PDF export** — Export any `.typ` file to PDF and open the result immediately.
- **Version snapshots** — Automatic snapshots on save; browse and restore earlier versions from the history panel.
- **AI assistant** — Chat panel supporting Claude CLI and Ollama. Fork sessions, rename chats, and continue conversations.
- **LaTeX import** — Import LaTeX template bundles (`.zip`) and convert them to Typst projects with a detailed report.
- **References panel** — Manage papers via local PDFs, `.bib` entries, and links with citation keys.
- **Writing mode** — Distraction-free mode that hides the preview panel.
- **Customizable layout** — Panels for AI Chat, Editor, Preview, Outline, and PDF Viewer. Switch between horizontal (side-by-side) and vertical (stacked) arrangements.
- **Dark theme** — "dark" and "claude" theme variants.

## Installation

### Prerequisites

**Node.js 20+**

Install via [nvm](https://github.com/nvm-sh/nvm) (recommended) or directly from [nodejs.org](https://nodejs.org):

```bash
# Using nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
nvm install 22
nvm use 22
```

**Rust**

Install via [rustup](https://rustup.rs):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Xcode Command-Line Tools** (macOS)

```bash
xcode-select --install
```

### Run

```bash
npm install
npm run tauri dev      # dev build with hot reload
npm run tauri build    # production app bundle
```

A bundled `tinymist` binary is resolved at startup — no separate installation is needed.

## Tests

```bash
npm run test:run                       # frontend (Vitest, jsdom)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust side
```

