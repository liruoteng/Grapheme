import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap } from "@codemirror/search";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "../../lib/logger";
import katex from "katex";
import { refractor } from "refractor/all";
import type { Element as HastElement, Nodes as HastNode, Root as HastRoot, Text as HastText } from "hast";
import { EditorSelection, EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import type { Extension, Range, Transaction, TransactionSpec } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  crosshairCursor,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { useEditorStore, type Reference } from "../../stores/editorStore";
import { copyImageFilesToAssets } from "../../lib/utils";
import { getActiveDragSource } from "../FileExplorer/fileDrag";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import { codeBlockLanguages } from "./codeBlockLanguages";
import {
  serializeTableWithLayout,
  tableAt,
  tableSnippet,
  type MarkdownTable,
  type MarkdownTableLayout,
} from "./markdownTable";
import "katex/dist/katex.min.css";
import "./MarkdownWysiwygEditor.css";

interface MarkdownWysiwygEditorProps {
  onSave?: (path: string, content: string, isExplicit?: boolean) => void;
  onSnapshot?: (path: string) => void;
  onPreviewTrigger?: (path: string, content: string) => void;
  externalContent?: { content: string; seq: number };
}

type DecorationRange = {
  from: number;
  to: number;
  className?: string;
  replace?: boolean;
  widget?: WidgetType;
  block?: boolean;
  line?: boolean;
  point?: boolean;
  side?: number;
};

type DecorationBuildRange = {
  from: number;
  to: number;
};

type MarkdownDecorationBuildOptions = {
  includeLayout?: boolean;
  includeInline?: boolean;
  ranges?: readonly DecorationBuildRange[];
  suppressActiveInline?: boolean;
  allowDefaultCursor?: boolean;
  selectionOverride?: { from: number; to: number };
};

type InlineRange = {
  from: number;
  to: number;
};

type ScrollSnapshot = {
  top: number;
  left: number;
  anchorPos: number | null;
  anchorTop: number | null;
};

const editTableSourceEffect = StateEffect.define<InlineRange | null>();
const editImageSourceEffect = StateEffect.define<InlineRange | null>();
const editHtmlBlockEffect = StateEffect.define<InlineRange | null>();
const revealMarkdownSyntaxEffect = StateEffect.define<null>();

const tableSourceEditRangeField = StateField.define<InlineRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      value = {
        from: transaction.changes.mapPos(value.from),
        to: transaction.changes.mapPos(value.to),
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(editTableSourceEffect)) value = effect.value;
    }

    if (value && transaction.selection) {
      const selection = transaction.state.selection.main;
      if (selection.to < value.from || selection.from > value.to) return null;
    }

    return value;
  },
});

const imageSourceEditRangeField = StateField.define<InlineRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      value = {
        from: transaction.changes.mapPos(value.from),
        to: transaction.changes.mapPos(value.to),
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(editImageSourceEffect)) value = effect.value;
    }

    if (value && transaction.selection) {
      const selection = transaction.state.selection.main;
      if (selection.to < value.from || selection.from > value.to) return null;
    }

    return value;
  },
});

const htmlBlockEditRangeField = StateField.define<InlineRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      value = {
        from: transaction.changes.mapPos(value.from),
        to: transaction.changes.mapPos(value.to),
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(editHtmlBlockEffect)) value = effect.value;
    }

    if (value && transaction.selection) {
      const selection = transaction.state.selection.main;
      if (selection.to < value.from || selection.from > value.to) return null;
    }

    return value;
  },
});

type MarkdownCodeBlock = {
  from: number;
  to: number;
  language: string;
  value: string;
  closed: boolean;
};

type MarkdownMathBlock = {
  from: number;
  to: number;
  value: string;
  kind: "dollar" | "bracket" | "environment";
};

type InlineMathMatch = {
  from: number;
  to: number;
  value: string;
};

type MarkdownImage = {
  from: number;
  to: number;
  alt: string;
  src: string;
  title?: string;
};

type MarkdownFrontmatter = {
  from: number;
  to: number;
  value: string;
  rows: Array<{ key: string; value: string }>;
};

type MarkdownFootnoteDefinition = {
  from: number;
  to: number;
  label: string;
  value: string;
};

type MarkdownHtmlBlock = {
  from: number;
  to: number;
  content: string;
};

type CitationOption = {
  key: string;
  label: string;
  meta: string;
};

type CitationMenuState = {
  x: number;
  y: number;
  from: number;
  to: number;
  options: CitationOption[];
  activeIndex: number;
};

type MarkdownDocSource = EditorState | EditorView;

function markdownDoc(source: MarkdownDocSource) {
  return "doc" in source ? source.doc : source.state.doc;
}

const prismAliases: Record<string, string> = {
  html: "markup",
  xml: "markup",
  svg: "markup",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  tex: "latex",
  cplusplus: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  "c#": "csharp",
  objectivec: "objectivec",
  "objective-c": "objectivec",
};

const codeSyntaxHighlightMaxDocLength = 100_000;
const previewUpdateDebounceMs = 500;
const inlineDecorationContextLineCount = 200;
const layoutDecorationContextLineCount = 12;

const blockHtmlTagNames = new Set([
  "address", "article", "aside", "blockquote", "body", "caption",
  "center", "col", "colgroup", "dd", "details", "dialog", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
  "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hr", "html", "iframe", "legend", "li", "link",
  "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup",
  "option", "p", "param", "section", "source", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul",
]);

const inlineHtmlTagNames = new Set([
  "span", "strong", "em", "b", "i", "u", "s", "ins", "del",
  "mark", "kbd", "sup", "sub", "small", "big", "abbr", "code",
  "time", "var", "q", "dfn", "cite", "samp", "a",
]);

const voidHtmlTagNames = new Set([
  "br", "hr", "img", "wbr", "input", "meta", "link", "area",
  "base", "col", "embed", "source", "track",
]);

function codeBlockLanguageOptions(current: string) {
  return [...new Set([current, ...codeBlockLanguages])];
}

function isMarkdownPath(path: string) {
  return path.endsWith(".md") || path.endsWith(".markdown");
}

function isExternalSrc(src: string) {
  return /^(https?:|data:|blob:|asset:)/i.test(src);
}

function dirname(path: string) {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}

function normalizePath(path: string) {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

function relativePath(fromDir: string, toPath: string) {
  const from = normalizePath(fromDir).split("/").filter(Boolean);
  const to = normalizePath(toPath).split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }
  return [...Array(from.length - common).fill(".."), ...to.slice(common)].join("/") || ".";
}

function activeMarkdownDir() {
  const activePath = useEditorStore.getState().activeTabPath;
  if (activePath) return dirname(activePath);
  return useEditorStore.getState().workspacePath ?? "";
}

function ancestorDirs(path: string) {
  const dirs: string[] = [];
  let current = normalizePath(path);
  while (current) {
    dirs.push(current);
    if (current === "/") break;
    current = dirname(current);
  }
  return dirs;
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function markdownAssetSrcCandidates(src: string) {
  if (!src || isExternalSrc(src)) return [src];
  if (src.startsWith("/")) return [convertFileSrc(src)];

  const baseDir = activeMarkdownDir();
  if (!baseDir) return [src];
  return uniqueValues(
    ancestorDirs(baseDir).map((dir) => convertFileSrc(normalizePath(`${dir}/${src}`)))
  );
}

function markdownImagePathForFile(path: string) {
  if (!path.startsWith("/")) return path;
  const baseDir = activeMarkdownDir();
  if (!baseDir) return path;
  return relativePath(baseDir, path);
}

function snippetOffset(snippet: string, offset: number) {
  return Math.max(0, Math.min(snippet.length, offset));
}

function markerRange(from: number, to: number, active: boolean, className = ""): DecorationRange {
  if (active) {
    return { from, to, className: `cm-md-marker cm-md-marker--active${className ? ` ${className}` : ""}` };
  }

  return { from, to, replace: true };
}

function inlineMarkerActive(markers: InlineRange[], cursorFrom: number, cursorTo: number) {
  if (cursorFrom !== cursorTo) {
    return markers.some((marker) => cursorFrom === marker.from && cursorTo === marker.to);
  }
  return markers.some((marker) => cursorTo >= marker.from && cursorFrom <= marker.to);
}

function rangeActive(range: InlineRange, cursorFrom: number, cursorTo: number, selectionEmpty: boolean) {
  if (!selectionEmpty) return cursorFrom === range.from && cursorTo === range.to;
  return cursorTo >= range.from && cursorFrom <= range.to;
}

function escaped(text: string, index: number) {
  let slashCount = 0;
  for (let pos = index - 1; pos >= 0 && text[pos] === "\\"; pos -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function inlineMathRanges(lineText: string, lineFrom: number, fromOffset: number): InlineMathMatch[] {
  const matches: InlineMathMatch[] = [];

  for (let index = fromOffset; index < lineText.length - 2; index += 1) {
    if (lineText[index] !== "\\" || lineText[index + 1] !== "(" || escaped(lineText, index)) continue;
    const close = lineText.indexOf("\\)", index + 2);
    if (close === -1) break;
    if (close > index + 2 && !escaped(lineText, close)) {
      matches.push({
        from: lineFrom + index,
        to: lineFrom + close + 2,
        value: lineText.slice(index + 2, close).trim(),
      });
    }
    index = close + 1;
  }

  for (let index = fromOffset; index < lineText.length; index += 1) {
    if (lineText[index] !== "$" || escaped(lineText, index)) continue;
    if (lineText[index + 1] === "$") {
      index += 1;
      continue;
    }
    const before = index === 0 ? "" : lineText[index - 1];
    const after = lineText[index + 1] ?? "";
    if (!after || /\s/.test(after) || /\d/.test(before)) continue;

    for (let close = index + 1; close < lineText.length; close += 1) {
      if (lineText[close] !== "$" || escaped(lineText, close)) continue;
      if (lineText[close + 1] === "$") continue;
      const beforeClose = lineText[close - 1] ?? "";
      const afterClose = lineText[close + 1] ?? "";
      if (/\s/.test(beforeClose) || /\d/.test(afterClose)) continue;
      if (close > index + 1) {
        matches.push({
          from: lineFrom + index,
          to: lineFrom + close + 1,
          value: lineText.slice(index + 1, close).trim(),
        });
      }
      index = close;
      break;
    }
  }

  return matches.sort((a, b) => a.from - b.from || a.to - b.to);
}

function frontmatterAtTop(source: MarkdownDocSource): MarkdownFrontmatter | null {
  const doc = markdownDoc(source);
  if (doc.lines < 3) return null;

  const first = doc.line(1);
  if (first.text.trim() !== "---") return null;

  const bodyLines: string[] = [];
  let close = null as null | ReturnType<typeof doc.line>;
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (line.text.trim() === "---") {
      close = line;
      break;
    }
    bodyLines.push(line.text);
  }

  if (!close) return null;

  const value = bodyLines.join("\n");
  const rows: MarkdownFrontmatter["rows"] = [];
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    rows.push({
      key: trimmed.slice(0, colonIndex).trim(),
      value: trimmed.slice(colonIndex + 1).trim(),
    });
  }

  return {
    from: first.from,
    to: close.to,
    value,
    rows,
  };
}

function footnoteDefinitionAt(source: MarkdownDocSource, lineNumber: number): MarkdownFootnoteDefinition | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);
  const match = openLine.text.match(/^(\s{0,3})\[\^([^\]\n]+)\]:[ \t]?(.*)$/);
  if (!match) return null;

  const lines = [match[3]];
  let lastLine = openLine;
  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const line = doc.line(nextLineNumber);
    if (!/^(?: {4}|\t)/.test(line.text)) break;
    lines.push(line.text.replace(/^(?: {4}|\t)/, ""));
    lastLine = line;
  }

  return {
    from: openLine.from,
    to: lastLine.to,
    label: match[2].trim(),
    value: lines.join("\n").trim(),
  };
}

function imageAtLine(lineText: string, lineFrom: number): MarkdownImage | null {
  const match = lineText.match(/^(\s*)!\[([^\]\n]*)\]\((\S+?)(?:\s+"([^"]+)")?\)\s*$/);
  if (!match) return null;

  const from = lineFrom + match[1].length;
  return {
    from,
    to: lineFrom + match[0].trimEnd().length,
    alt: match[2],
    src: match[3],
    title: match[4],
  };
}

function codeBlockAt(source: MarkdownDocSource, lineNumber: number): MarkdownCodeBlock | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);
  const open = openLine.text.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (!open) return null;

  const fence = open[2];
  const fenceChar = fence[0];
  const closeRe = new RegExp(`^\\s*\\${fenceChar}{${fence.length},}\\s*$`);
  const language = normalizePrismLanguage(open[3].trim().split(/\s+/)[0] ?? "");
  let lastLine = openLine;
  const valueLines: string[] = [];

  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const line = doc.line(nextLineNumber);
    lastLine = line;
    if (closeRe.test(line.text)) {
      return {
        from: openLine.from,
        to: line.to,
        language,
        value: valueLines.join("\n"),
        closed: true,
      };
    }
    valueLines.push(line.text);
  }

  return {
    from: openLine.from,
    to: lastLine.to,
    language,
    value: valueLines.join("\n"),
    closed: false,
  };
}

function mathBlockAt(source: MarkdownDocSource, lineNumber: number): MarkdownMathBlock | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);

  const singleLineDollar = openLine.text.match(/^\s*\$\$(.+?)\$\$\s*$/);
  if (singleLineDollar) {
    return {
      from: openLine.from,
      to: openLine.to,
      value: singleLineDollar[1].trim(),
      kind: "dollar",
    };
  }

  const singleLineBracket = openLine.text.match(/^\s*\\\[(.+?)\\\]\s*$/);
  if (singleLineBracket) {
    return {
      from: openLine.from,
      to: openLine.to,
      value: singleLineBracket[1].trim(),
      kind: "bracket",
    };
  }

  const environment = openLine.text.match(/^\s*\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}\s*$/);
  if (environment) {
    const environmentName = environment[1];
    const lines = [openLine.text.trim()];
    let lastLine = openLine;
    const closeRe = new RegExp(`^\\s*\\\\end\\{${environmentName.replace(/\*/g, "\\*")}\\}\\s*$`);
    for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
      const line = doc.line(nextLineNumber);
      lastLine = line;
      lines.push(line.text.trimEnd());
      if (closeRe.test(line.text)) {
        return {
          from: openLine.from,
          to: line.to,
          value: lines.join("\n").trim(),
          kind: "environment",
        };
      }
    }

    return {
      from: openLine.from,
      to: lastLine.to,
      value: lines.join("\n").trim(),
      kind: "environment",
    };
  }

  const dollarOpen = /^\s*\$\$\s*$/.test(openLine.text);
  const bracketOpen = /^\s*\\\[\s*$/.test(openLine.text);
  if (!dollarOpen && !bracketOpen) return null;

  const lines: string[] = [];
  let lastLine = openLine;
  const closeRe = dollarOpen ? /^\s*\$\$\s*$/ : /^\s*\\\]\s*$/;
  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const line = doc.line(nextLineNumber);
    lastLine = line;
    if (closeRe.test(line.text)) {
      return {
        from: openLine.from,
        to: line.to,
        value: lines.join("\n").trim(),
        kind: dollarOpen ? "dollar" : "bracket",
      };
    }
    lines.push(line.text);
  }

  return {
    from: openLine.from,
    to: lastLine.to,
    value: lines.join("\n").trim(),
    kind: dollarOpen ? "dollar" : "bracket",
  };
}

function htmlBlockAt(source: MarkdownDocSource, lineNumber: number): MarkdownHtmlBlock | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);
  const openMatch = openLine.text.match(/^( {0,3})<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*?)?)\s*>/);
  if (!openMatch) return null;

  const tagName = openMatch[2].toLowerCase();
  const selfClosing = openMatch[0].endsWith("/>");
  if (selfClosing || !blockHtmlTagNames.has(tagName)) return null;

  const closeRe = new RegExp(`<\\/${tagName}\\s*>`, "i");
  const sameLineClose = closeRe.exec(openLine.text.slice(openMatch[0].length));
  if (sameLineClose) {
    const endPos = openLine.from + openMatch[0].length + sameLineClose.index + sameLineClose[0].length;
    return { from: openLine.from, to: endPos, content: doc.sliceString(openLine.from, endPos) };
  }

  let depth = 1;
  const closeTagRe = new RegExp(`<\\/${tagName}\\s*>`, "i");
  const openTagRe = new RegExp(`<${tagName}(\\s[^>]*?)?\\s*>`, "i");
  for (let ln = lineNumber + 1; ln <= doc.lines; ln++) {
    const scanLine = doc.line(ln);
    let pos = 0;
    while (pos < scanLine.text.length) {
      const remaining = scanLine.text.slice(pos);
      const nextClose = closeTagRe.exec(remaining);
      const nextOpen = openTagRe.exec(remaining);

      const nextCloseIndex = nextClose ? pos + nextClose.index : -1;
      const nextOpenIndex = nextOpen ? pos + nextOpen.index : -1;

      if (nextCloseIndex !== -1 && (nextOpenIndex === -1 || nextCloseIndex < nextOpenIndex)) {
        depth--;
        if (depth === 0) {
          const toPos = scanLine.from + nextCloseIndex + (nextClose?.[0].length ?? 0);
          return { from: openLine.from, to: toPos, content: doc.sliceString(openLine.from, toPos) };
        }
        pos = nextCloseIndex + 1;
      } else if (nextOpenIndex !== -1) {
        depth++;
        pos = nextOpenIndex + 1;
      } else {
        break;
      }
    }
  }

  return null;
}

function htmlCommentAt(source: MarkdownDocSource, lineNumber: number): { from: number; to: number } | null {
  const doc = markdownDoc(source);
  const startLine = doc.line(lineNumber);
  const openIndex = startLine.text.indexOf("<!--");
  if (openIndex === -1) return null;
  if (openIndex > 3 || (openIndex > 0 && startLine.text.slice(0, openIndex).trim() !== "")) return null;

  const afterOpen = startLine.text.slice(openIndex + 4);
  const sameLineClose = afterOpen.indexOf("-->");
  if (sameLineClose !== -1) {
    const endPos = startLine.from + openIndex + 4 + sameLineClose + 3;
    return { from: startLine.from, to: endPos };
  }

  for (let ln = lineNumber + 1; ln <= doc.lines; ln++) {
    const scanLine = doc.line(ln);
    const closeIndex = scanLine.text.indexOf("-->");
    if (closeIndex !== -1) {
      const toPos = scanLine.from + closeIndex + 3;
      return { from: startLine.from, to: toPos };
    }
  }

  return null;
}

function normalizePrismLanguage(language: string) {
  const normalized = language.trim().toLowerCase().replace(/^language-/, "");
  return prismAliases[normalized] ?? normalized;
}

function captureScrollSnapshot(view: EditorView, preferredAnchorPos?: number | null): ScrollSnapshot {
  const rect = view.scrollDOM.getBoundingClientRect();
  const anchorPos = preferredAnchorPos ?? view.posAtCoords({
    x: rect.left + Math.min(rect.width / 2, 320),
    y: rect.top + Math.min(96, Math.max(24, rect.height / 4)),
  });
  const anchorCoords = anchorPos === null ? null : view.coordsAtPos(anchorPos);

  return {
    top: view.scrollDOM.scrollTop,
    left: view.scrollDOM.scrollLeft,
    anchorPos,
    anchorTop: anchorCoords?.top ?? null,
  };
}

function restoreScrollPosition(view: EditorView, snapshot: ScrollSnapshot) {
  if (useEditorStore.getState().typewriterMode) return;

  view.requestMeasure({
    read: () => snapshot,
    write: (current) => {
      const restore = () => {
        view.scrollDOM.scrollTop = current.top;
        view.scrollDOM.scrollLeft = current.left;
        if (current.anchorPos !== null && current.anchorTop !== null) {
          const nextAnchor = view.coordsAtPos(current.anchorPos);
          if (nextAnchor) view.scrollDOM.scrollTop += nextAnchor.top - current.anchorTop;
        }
      };
      restore();
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    },
  });
}

function dispatchPreservingScroll(view: EditorView, transaction: TransactionSpec, anchorPos?: number | null) {
  const snapshot = captureScrollSnapshot(view, anchorPos);
  view.dispatch(transaction);
  restoreScrollPosition(view, snapshot);
}

function selectRangePreservingScroll(view: EditorView, from: number, to: number) {
  dispatchPreservingScroll(view, { selection: EditorSelection.range(from, to) }, from);
}

function selectCursorPreservingScroll(view: EditorView, pos: number) {
  dispatchPreservingScroll(view, { selection: EditorSelection.cursor(pos) }, pos);
}

function shortAuthor(authors?: string[]) {
  const first = authors?.[0]?.trim();
  if (!first) return "";
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] ?? first;
}

function citationDisplayForKey(key: string) {
  const ref = useEditorStore.getState().references.find((r) => r.bibKey === key);
  if (!ref) {
    return {
      label: `@${key}`,
      title: `Missing reference: ${key}`,
      missing: true,
    };
  }

  const author = shortAuthor(ref.authors);
  const label = author && ref.year
    ? `${author} ${ref.year}`
    : author || ref.title?.slice(0, 28) || key;

  return {
    label,
    title: ref.title ? `${ref.title} (@${key})` : `@${key}`,
    missing: false,
  };
}

function citationOptions(query: string, refs: Reference[]) {
  const q = query.toLowerCase();
  return refs
    .filter((ref) => {
      if (!ref.bibKey) return false;
      if (!q) return true;
      return (
        ref.bibKey.toLowerCase().includes(q) ||
        (ref.title?.toLowerCase().includes(q) ?? false) ||
        (ref.authors?.some((author) => author.toLowerCase().includes(q)) ?? false)
      );
    })
    .slice(0, 8)
    .map((ref): CitationOption => {
      const key = ref.bibKey!;
      const author = shortAuthor(ref.authors);
      const label = author && ref.year ? `${author} ${ref.year}` : ref.title || key;
      const meta = ref.title && ref.title !== label ? ref.title : ref.name;
      return { key, label, meta };
    });
}

function syntaxTokenClasses(tokens: string[]) {
  return [...new Set(tokens)]
    .map((token) => token.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
    .filter((token) => token && token !== "token")
    .map((token) => `cm-md-token-${token}`);
}

function hastClassNames(node: HastElement) {
  const className = node.properties?.className;
  if (Array.isArray(className)) return className.map(String);
  if (typeof className === "string") return className.split(/\s+/);
  return [];
}

function isHastText(node: HastNode): node is HastText {
  return node.type === "text";
}

function isHastElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

function addSyntaxTokenDecorations(
  ranges: DecorationRange[],
  lineText: string,
  lineFrom: number,
  language: string,
) {
  if (!language || !lineText || !refractor.registered(language)) return;

  const visit = (node: HastRoot | HastNode, offset: number, inherited: string[]): number => {
    if (isHastText(node)) {
      const end = offset + node.value.length;
      const classes = syntaxTokenClasses(inherited);
      if (offset < end && classes.length > 0) {
        ranges.push({
          from: lineFrom + offset,
          to: lineFrom + end,
          className: `cm-md-token ${classes.join(" ")}`,
        });
      }
      return end;
    }

    if (isHastElement(node)) {
      const classes = [...hastClassNames(node), ...inherited];
      return node.children.reduce((current, child) => visit(child, current, classes), offset);
    }

    if ("children" in node) {
      return node.children.reduce((current, child) => visit(child, current, inherited), offset);
    }

    return offset;
  };

  try {
    visit(refractor.highlight(lineText, language), 0, []);
  } catch {
    // Some Prism grammars are permissive enough to throw on partial lines.
    // In that case, keep the code readable without token colors.
  }
}

function addLatexSyntaxTokenDecorations(
  ranges: DecorationRange[],
  lineText: string,
  lineFrom: number,
) {
  let index = 0;

  const pushToken = (from: number, to: number, className: string) => {
    if (from >= to) return;
    ranges.push({
      from: lineFrom + from,
      to: lineFrom + to,
      className: `cm-md-token cm-md-latex-token ${className}`,
    });
  };

  while (index < lineText.length) {
    const char = lineText[index];

    if (char === "%") {
      pushToken(index, lineText.length, "cm-md-token-comment");
      break;
    }

    if (char === "\\") {
      const command = lineText.slice(index).match(/^\\(?:[a-zA-Z]+[*]?|.)/);
      if (command) {
        pushToken(index, index + command[0].length, "cm-md-token-function");
        index += command[0].length;
        continue;
      }
    }

    if (/[A-Za-z]/.test(char)) {
      const variable = lineText.slice(index).match(/^[A-Za-z]+/);
      if (variable) {
        pushToken(index, index + variable[0].length, "cm-md-token-variable");
        index += variable[0].length;
        continue;
      }
    }

    if (/\d/.test(char)) {
      const number = lineText.slice(index).match(/^\d+(?:\.\d+)?/);
      if (number) {
        pushToken(index, index + number[0].length, "cm-md-token-number");
        index += number[0].length;
        continue;
      }
    }

    if (/[[\]{}()]/.test(char)) {
      pushToken(index, index + 1, "cm-md-token-punctuation");
      index += 1;
      continue;
    }

    if (/[+\-*/=<>^_&|!,:;]/.test(char)) {
      pushToken(index, index + 1, "cm-md-token-operator");
    }

    index += 1;
  }
}

let pendingTableControlRestore: {
  tableFrom: number;
  rowIndex: number | null;
  colIndex: number | null;
} | null = null;

class MarkdownTableWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(private readonly table: MarkdownTable) {
    super();
  }

  eq(other: MarkdownTableWidget) {
    if (this.table.from !== other.table.from ||
      this.table.to !== other.table.to ||
      this.table.header.length !== other.table.header.length ||
      this.table.alignments.length !== other.table.alignments.length ||
      this.table.rows.length !== other.table.rows.length) return false;
    for (let i = 0; i < this.table.header.length; i++) {
      if (this.table.header[i] !== other.table.header[i]) return false;
    }
    for (let i = 0; i < this.table.alignments.length; i++) {
      if (this.table.alignments[i] !== other.table.alignments[i]) return false;
    }
    for (let i = 0; i < this.table.rows.length; i++) {
      const a = this.table.rows[i];
      const b = other.table.rows[i];
      if (a.length !== b.length) return false;
      for (let j = 0; j < a.length; j++) {
        if (a[j] !== b[j]) return false;
      }
    }
    return true;
  }

  toDOM(view: EditorView) {
    this.cleanup?.();
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-render";
    wrap.tabIndex = -1;
    const draftHeader = [...this.table.header];
    const draftAlignments = [...this.table.alignments];
    const draftRows = this.table.rows.map((row) => [...row]);
    const tableFrom = this.table.from;
    let tableTo = this.table.to;
    let committedSource = view.state.sliceDoc(tableFrom, tableTo);
    const renderedCells = new Map<string, HTMLTableCellElement>();
    let selectionAnchor: { row: number; col: number } | null = null;
    let lastClickedCell: { row: number; col: number } | null = null;
    let selectedRange: { startRow: number; endRow: number; startCol: number; endCol: number } | null = null;
    let draggingTableSelection = false;
    let colElements: HTMLTableColElement[] = [];
    let columnHandleElements: HTMLButtonElement[] = [];
    let rowHandleElements: HTMLButtonElement[] = [];
    let stopColumnResize: (() => void) | null = null;
    let stopAxisDrag: ((event?: MouseEvent) => void) | null = null;
    let activeAxisDropTarget: HTMLElement | null = null;
    let activeAxisDropPosition: "before" | "after" = "before";
    let activeAxisDrag: { kind: "row" | "column"; index: number } | null = null;
    let axisDragStatus: HTMLDivElement | null = null;
    let axisDropGuide: HTMLDivElement | null = null;
    let axisDragPreview: HTMLDivElement | null = null;
    let axisDragPreviewGeometry: {
      kind: "row" | "column";
      left: number;
      top: number;
      width: number;
      height: number;
      originX: number | null;
      originY: number | null;
    } | null = null;
    let axisDragPreviewFrame: number | null = null;
    let axisDragPreviewDelta = { x: 0, y: 0 };
    let syncTableHandles = () => {};
    let activeRowIndex: number | null = null;
    let activeColIndex: number | null = null;
    let verticalResizeGuide: HTMLDivElement | null = null;
    let horizontalResizeGuide: HTMLDivElement | null = null;
    const initialColWidths = this.table.layout?.colWidths?.length === this.table.header.length
      ? [...this.table.layout.colWidths]
      : this.table.header.map(() => 100 / Math.max(1, this.table.header.length));
    const rowHeights = this.table.layout?.rowHeights
      ? this.table.layout.rowHeights.slice(0, this.table.rows.length + 1)
      : [];
    const colWidths = initialColWidths;
    let layoutIsPersisted = Boolean(this.table.layout);

    const cellKey = (row: number, col: number) => `${row}:${col}`;
    const normalizeRange = (from: { row: number; col: number }, to: { row: number; col: number }) => ({
      startRow: Math.min(from.row, to.row),
      endRow: Math.max(from.row, to.row),
      startCol: Math.min(from.col, to.col),
      endCol: Math.max(from.col, to.col),
    });

    const clearBrowserSelection = () => {
      window.getSelection()?.removeAllRanges();
    };

    const tableValueAt = (row: number, col: number) => {
      if (row === 0) return draftHeader[col] ?? "";
      return draftRows[row - 1]?.[col] ?? "";
    };

    const selectedTableText = () => {
      if (!selectedRange) return "";

      const rows: string[] = [];
      for (let row = selectedRange.startRow; row <= selectedRange.endRow; row += 1) {
        const cells: string[] = [];
        for (let col = selectedRange.startCol; col <= selectedRange.endCol; col += 1) {
          cells.push(tableValueAt(row, col));
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    };

    const applyTableSelection = (from: { row: number; col: number }, to: { row: number; col: number }) => {
      selectedRange = normalizeRange(from, to);
      for (const cell of renderedCells.values()) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        const selected =
          row >= selectedRange.startRow &&
          row <= selectedRange.endRow &&
          col >= selectedRange.startCol &&
          col <= selectedRange.endCol;
        cell.classList.toggle("is-selected", selected);
        cell.classList.toggle("is-selection-anchor", selected && row === from.row && col === from.col);
        if (selected) cell.setAttribute("aria-selected", "true");
        else cell.removeAttribute("aria-selected");
      }
    };

    const clearTableSelection = () => {
      selectedRange = null;
      for (const cell of renderedCells.values()) {
        cell.classList.remove("is-selected", "is-selection-anchor");
        cell.removeAttribute("aria-selected");
      }
    };

    const moveArray = <T,>(items: T[], fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return [...items];
      if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return [...items];
      const next = [...items];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    };

    const measuredRowHeights = () => {
      const rows = visualRowElements();
      if (rows.length === draftRows.length + 1) {
        return rows.map((row, index) => rowHeights[index] ?? row.getBoundingClientRect().height);
      }
      return rowHeights.slice(0, draftRows.length + 1);
    };

    const measuredLayout = (): MarkdownTableLayout => ({
      colWidths: colWidths.slice(0, draftHeader.length),
      rowHeights: measuredRowHeights(),
    });

    const currentLayout = () => layoutIsPersisted ? measuredLayout() : undefined;

    const tableSource = (
      header: string[],
      alignments: MarkdownTable["alignments"],
      rows: string[][],
      layout = currentLayout(),
    ) => serializeTableWithLayout({ header, alignments, rows }, layout);
    const persistedLayout = (layout: MarkdownTableLayout) => layoutIsPersisted ? layout : undefined;

    const persistLayoutToSource = () => {
      layoutIsPersisted = true;
      const nextSource = tableSource(draftHeader, draftAlignments, draftRows, measuredLayout());
      if (committedSource === nextSource) return;
      view.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: nextSource },
      });
      tableTo = tableFrom + nextSource.length;
      committedSource = nextSource;
    };

    const commitTableEdit = () => {
      const nextSource = tableSource(
        draftHeader,
        draftAlignments,
        draftRows,
      );
      if (committedSource === nextSource) return;

      view.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: nextSource },
      });
      tableTo = tableFrom + nextSource.length;
      committedSource = nextSource;
    };

    const replaceTableSource = (nextSource: string) => {
      const replaceTo = nextSource === "" && view.state.sliceDoc(tableTo, tableTo + 1) === "\n"
        ? tableTo + 1
        : tableTo;
      view.dispatch({
        changes: { from: tableFrom, to: replaceTo, insert: nextSource },
        selection: EditorSelection.cursor(tableFrom),
        scrollIntoView: true,
      });
      tableTo = tableFrom + nextSource.length;
      committedSource = nextSource;
      view.focus();
    };

    const selectedColumnIndexes = () => {
      if (selectedRange) {
        const indexes: number[] = [];
        for (let col = selectedRange.startCol; col <= selectedRange.endCol; col += 1) indexes.push(col);
        return indexes;
      }
      return activeColIndex !== null ? [activeColIndex] : [];
    };

    const selectedDataRowIndexes = () => {
      if (selectedRange) {
        const indexes: number[] = [];
        for (let row = Math.max(1, selectedRange.startRow); row <= selectedRange.endRow; row += 1) indexes.push(row - 1);
        if (indexes.length > 0) return indexes;
      }
      return activeRowIndex !== null && activeRowIndex > 0 ? [activeRowIndex - 1] : [];
    };

    const nextTableSource = (header: string[], alignments: MarkdownTable["alignments"], rows: string[][]) => (
      tableSource(header, alignments, rows, layoutIsPersisted ? {
        colWidths: colWidths.slice(0, header.length),
        rowHeights: measuredRowHeights().slice(0, rows.length + 1),
      } : undefined)
    );

    const replaceWithTableSource = (nextSource: string) => {
      commitTableEdit();
      replaceTableSource(nextSource);
    };

    const setAxisDragSource = (kind: "row" | "column", index: number, dragging: boolean) => {
      const handles = kind === "row" ? rowHandleElements : columnHandleElements;
      handles.forEach((handle, handleIndex) => {
        handle.classList.toggle("is-dragging-source", dragging && handleIndex === index);
        if (dragging && handleIndex === index) handle.setAttribute("aria-grabbed", "true");
        else handle.removeAttribute("aria-grabbed");
      });
      activeAxisDrag = dragging ? { kind, index } : null;
    };

    const clearAxisDragPreview = () => {
      if (axisDragPreviewFrame !== null) {
        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(axisDragPreviewFrame);
        else window.clearTimeout(axisDragPreviewFrame);
      }
      axisDragPreviewFrame = null;
      axisDragPreview?.remove();
      axisDragPreview = null;
      axisDragPreviewGeometry = null;
      axisDragPreviewDelta = { x: 0, y: 0 };
    };

    const updateAxisDragPreview = (kind: "row" | "column", index: number, clientX?: number, clientY?: number) => {
      if (!axisDragPreview) {
        const tableElement = frame.querySelector("table");
        const sourceElement = kind === "row"
          ? visualRowElements()[index]
          : [...frame.querySelectorAll<HTMLTableCellElement>("thead th")][index];
        if (!tableElement || !sourceElement) return;

        const frameRect = frame.getBoundingClientRect();
        const tableRect = tableElement.getBoundingClientRect();
        const sourceRect = sourceElement.getBoundingClientRect();
        const axisHandle = (kind === "row" ? rowHandleElements : columnHandleElements)[index];
        const handleRect = axisHandle?.getBoundingClientRect();
        if (!handleRect) return;
        axisDragPreview = document.createElement("div");
        axisDragPreview.className = `cm-md-table-axis-drag-preview cm-md-table-axis-drag-preview--${kind}`;
        axisDragPreview.setAttribute("aria-hidden", "true");
        const previewHandle = document.createElement("span");
        previewHandle.className = `cm-md-table-axis-drag-preview-handle cm-md-table-axis-drag-preview-handle--${kind}`;
        previewHandle.textContent = "...";
        axisDragPreview.appendChild(previewHandle);
        frame.appendChild(axisDragPreview);
        axisDragPreviewGeometry = {
          kind,
          left: (kind === "row" ? handleRect.left : sourceRect.left) - frameRect.left,
          top: (kind === "row" ? sourceRect.top : handleRect.top) - frameRect.top,
          width: kind === "row" ? tableRect.right - handleRect.left : sourceRect.width,
          height: kind === "row" ? sourceRect.height : tableRect.bottom - handleRect.top,
          originX: clientX ?? null,
          originY: clientY ?? null,
        };
        axisDragPreview.style.left = `${axisDragPreviewGeometry.left}px`;
        axisDragPreview.style.top = `${axisDragPreviewGeometry.top}px`;
        axisDragPreview.style.width = `${axisDragPreviewGeometry.width}px`;
        axisDragPreview.style.height = `${axisDragPreviewGeometry.height}px`;
      }
      if (!axisDragPreviewGeometry || axisDragPreviewGeometry.kind !== kind) return;
      axisDragPreviewDelta = {
        x: clientX == null || axisDragPreviewGeometry.originX == null ? 0 : clientX - axisDragPreviewGeometry.originX,
        y: clientY == null || axisDragPreviewGeometry.originY == null ? 0 : clientY - axisDragPreviewGeometry.originY,
      };
      if (axisDragPreviewFrame !== null) return;
      const render = () => {
        axisDragPreviewFrame = null;
        if (!axisDragPreview) return;
        axisDragPreview.style.transform = `translate(${kind === "column" ? axisDragPreviewDelta.x : 0}px, ${kind === "row" ? axisDragPreviewDelta.y : 0}px)`;
      };
      if (typeof window.requestAnimationFrame === "function") axisDragPreviewFrame = window.requestAnimationFrame(render);
      else axisDragPreviewFrame = window.setTimeout(render, 0);
    };

    const clearAxisDropTarget = () => {
      activeAxisDropTarget?.classList.remove("is-drop-target");
      activeAxisDropTarget?.removeAttribute("data-drop-position");
      activeAxisDropTarget?.removeAttribute("aria-describedby");
      activeAxisDropTarget = null;
      activeAxisDropPosition = "before";
      axisDropGuide?.classList.remove("is-visible", "cm-md-table-axis-drop-guide--row", "cm-md-table-axis-drop-guide--column");
      if (axisDragStatus) axisDragStatus.textContent = "";
    };

    const updateAxisDropGuide = (handle: HTMLElement, position: "before" | "after") => {
      if (!axisDropGuide) return;
      const tableElement = frame.querySelector("table");
      if (!tableElement) return;
      const frameRect = frame.getBoundingClientRect();
      const tableRect = tableElement.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const isRow = handle.classList.contains("cm-md-table-row-handle");
      axisDropGuide.classList.remove("cm-md-table-axis-drop-guide--row", "cm-md-table-axis-drop-guide--column");
      axisDropGuide.classList.add(isRow ? "cm-md-table-axis-drop-guide--row" : "cm-md-table-axis-drop-guide--column", "is-visible");
      axisDropGuide.style.left = `${(isRow ? tableRect.left : position === "before" ? handleRect.left : handleRect.right) - frameRect.left}px`;
      axisDropGuide.style.top = `${(isRow ? position === "before" ? handleRect.top : handleRect.bottom : tableRect.top) - frameRect.top}px`;
      axisDropGuide.style.width = `${isRow ? tableRect.width : 3}px`;
      axisDropGuide.style.height = `${isRow ? 3 : tableRect.height}px`;
    };

    const axisDropPositionAt = (handle: HTMLElement, clientX: number, clientY: number) => {
      const rect = handle.getBoundingClientRect();
      const isRow = handle.classList.contains("cm-md-table-row-handle");
      const coordinate = isRow ? clientY : clientX;
      const start = isRow ? rect.top : rect.left;
      const size = isRow ? rect.height : rect.width;
      return size > 0 && coordinate - start > size / 2 ? "after" as const : "before" as const;
    };

    const destinationIndex = (fromIndex: number, targetIndex: number, position: "before" | "after", length: number) => {
      const insertionIndex = position === "after" ? targetIndex + 1 : targetIndex;
      const destination = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
      return Math.max(0, Math.min(length - 1, destination));
    };

    const setAxisDropTarget = (handle: HTMLElement | null, position: "before" | "after") => {
      clearAxisDropTarget();
      if (!handle) return;
      activeAxisDropTarget = handle;
      activeAxisDropPosition = position;
      handle.classList.add("is-drop-target");
      handle.dataset.dropPosition = position;
      updateAxisDropGuide(handle, position);
      handle.setAttribute("aria-describedby", axisDragStatus?.id ?? "");
      if (axisDragStatus && activeAxisDrag) {
        const targetIndex = Number(handle.dataset.index) + 1;
        axisDragStatus.textContent = `Move ${activeAxisDrag.kind} ${activeAxisDrag.index + 1} ${position} ${activeAxisDrag.kind} ${targetIndex}`;
      }
    };

    const clearHoveredAxisHandles = () => {
      for (const handle of rowHandleElements) handle.classList.remove("is-hover-axis");
      for (const handle of columnHandleElements) handle.classList.remove("is-hover-axis");
    };

    const clearActiveCellHandles = () => {
      wrap.classList.remove("is-controls-active");
      activeRowIndex = null;
      activeColIndex = null;
      clearHoveredAxisHandles();
      for (const handle of rowHandleElements) handle.classList.remove("is-active-axis");
      for (const handle of columnHandleElements) handle.classList.remove("is-active-axis");
    };

    const setActiveHandles = (rowIndex: number | null, colIndex: number | null) => {
      wrap.classList.add("is-controls-active");
      activeRowIndex = rowIndex;
      activeColIndex = colIndex;
      for (const [index, handle] of rowHandleElements.entries()) {
        handle.classList.toggle("is-active-axis", index === rowIndex);
      }
      for (const [index, handle] of columnHandleElements.entries()) {
        handle.classList.toggle("is-active-axis", index === colIndex);
      }
    };

    const setActiveCellHandles = (rowIndex: number, colIndex: number) => {
      setActiveHandles(rowIndex, colIndex);
    };

    const setActiveRowHandle = (rowIndex: number) => {
      setActiveHandles(rowIndex, activeColIndex);
    };

    const setActiveColumnHandle = (colIndex: number) => {
      setActiveHandles(activeRowIndex, colIndex);
    };

    const handleAtPoint = <T extends HTMLElement>(handles: T[], clientX: number, clientY: number) => {
      return handles.find((handle) => {
        const rect = handle.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      }) ?? null;
    };

    const trackAxisHover = (event: MouseEvent) => {
      const rowHandle = handleAtPoint(rowHandleElements, event.clientX, event.clientY);
      const columnHandle = handleAtPoint(columnHandleElements, event.clientX, event.clientY);
      if (!wrap.classList.contains("is-controls-active") && !rowHandle && !columnHandle) return;
      clearHoveredAxisHandles();
      if (rowHandle) {
        rowHandle.classList.add("is-hover-axis");
        setActiveRowHandle(Number(rowHandle.dataset.index));
      }
      if (columnHandle) {
        columnHandle.classList.add("is-hover-axis");
        setActiveColumnHandle(Number(columnHandle.dataset.index));
      }
    };

    const startAxisDrag = (event: MouseEvent, kind: "row" | "column", fromIndex: number) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      clearBrowserSelection();
      wrap.classList.add("is-dragging-axis");
      setAxisDragSource(kind, fromIndex, true);
      updateAxisDragPreview(kind, fromIndex, event.clientX, event.clientY);

      const selector = kind === "row" ? ".cm-md-table-row-handle" : ".cm-md-table-column-handle";
      const onMouseMove = (moveEvent: MouseEvent) => {
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
        const handle = target?.closest<HTMLElement>(selector);
        const validTarget = handle && wrap.contains(handle) ? handle : null;
        updateAxisDragPreview(kind, fromIndex, moveEvent.clientX, moveEvent.clientY);
        if (activeAxisDropTarget === validTarget && validTarget) {
          setAxisDropTarget(validTarget, axisDropPositionAt(validTarget, moveEvent.clientX, moveEvent.clientY));
          return;
        }
        setAxisDropTarget(validTarget, validTarget ? axisDropPositionAt(validTarget, moveEvent.clientX, moveEvent.clientY) : "before");
      };
      const onMouseUp = (upEvent?: MouseEvent) => {
        const target = upEvent ? document.elementFromPoint(upEvent.clientX, upEvent.clientY) as HTMLElement | null : null;
        const handle = target?.closest<HTMLElement>(selector);
        const targetIndex = Number(handle?.dataset.index);
        const toIndex = handle && Number.isFinite(targetIndex)
          ? destinationIndex(fromIndex, targetIndex, activeAxisDropPosition, kind === "row" ? draftRows.length + 1 : draftHeader.length)
          : Number.NaN;
        clearAxisDropTarget();
        clearAxisDragPreview();
        setAxisDragSource(kind, fromIndex, false);
        wrap.classList.remove("is-dragging-axis");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        stopAxisDrag = null;
        if (!handle || !wrap.contains(handle) || !Number.isFinite(toIndex) || toIndex === fromIndex) return;
        if (kind === "row") {
          const visualRows = moveArray([draftHeader, ...draftRows], fromIndex, toIndex);
          const visualHeights = moveArray(measuredRowHeights(), fromIndex, toIndex);
          replaceWithTableSource(tableSource(
            visualRows[0] ?? draftHeader,
            draftAlignments,
            visualRows.slice(1),
            persistedLayout({ colWidths: colWidths.slice(0, draftHeader.length), rowHeights: visualHeights }),
          ));
          return;
        }

        replaceWithTableSource(tableSource(
          moveArray(draftHeader, fromIndex, toIndex),
          moveArray(draftAlignments, fromIndex, toIndex),
          draftRows.map((row) => moveArray(row, fromIndex, toIndex)),
          persistedLayout({
            colWidths: moveArray(colWidths, fromIndex, toIndex),
            rowHeights: measuredRowHeights(),
          }),
        ));
      };

      stopAxisDrag = onMouseUp;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const applyColumnWidths = () => {
      for (const [index, col] of colElements.entries()) {
        col.style.width = `${colWidths[index]}%`;
      }
    };

    const startColumnResize = (event: MouseEvent, colIndex: number) => {
      if (colIndex >= colWidths.length - 1) return;
      event.preventDefault();
      event.stopPropagation();

      const tableElement = colElements[colIndex]?.closest("table");
      const tableWidth = tableElement?.getBoundingClientRect().width ?? 0;
      if (tableWidth <= 0) return;

      wrap.classList.add("is-resizing-column");
      clearBrowserSelection();
      const startX = event.clientX;
      const startCurrent = colWidths[colIndex];
      const startNext = colWidths[colIndex + 1];
      const total = startCurrent + startNext;
      const minWidth = 8;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = ((moveEvent.clientX - startX) / tableWidth) * 100;
        const nextCurrent = Math.max(minWidth, Math.min(total - minWidth, startCurrent + delta));
        colWidths[colIndex] = nextCurrent;
        colWidths[colIndex + 1] = total - nextCurrent;
        applyColumnWidths();
        syncTableHandles();
        showVerticalResizeGuide(colElements[colIndex].getBoundingClientRect().right);
      };
      const onMouseUp = () => {
        wrap.classList.remove("is-resizing-column");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        stopColumnResize = null;
        syncTableHandles();
        verticalResizeGuide?.classList.remove("is-visible");
        persistLayoutToSource();
      };

      stopColumnResize = onMouseUp;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const visualRowElements = () => [headRow, ...tbody.rows];

    const showVerticalResizeGuide = (clientX: number) => {
      if (!verticalResizeGuide) return;
      const tableRect = table.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      verticalResizeGuide.style.left = `${clientX - frameRect.left}px`;
      verticalResizeGuide.style.top = `${tableRect.top - frameRect.top}px`;
      verticalResizeGuide.style.height = `${tableRect.height}px`;
      verticalResizeGuide.classList.add("is-visible");
    };

    const showHorizontalResizeGuide = (clientY: number) => {
      if (!horizontalResizeGuide) return;
      const tableRect = table.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      horizontalResizeGuide.style.left = `${tableRect.left - frameRect.left}px`;
      horizontalResizeGuide.style.top = `${clientY - frameRect.top}px`;
      horizontalResizeGuide.style.width = `${tableRect.width}px`;
      horizontalResizeGuide.classList.add("is-visible");
    };

    const hideResizeGuides = () => {
      verticalResizeGuide?.classList.remove("is-visible");
      horizontalResizeGuide?.classList.remove("is-visible");
    };

    const columnBoundaryAt = (event: MouseEvent, cell: HTMLTableCellElement) => {
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(col) || col >= draftHeader.length - 1) return null;

      const rect = cell.getBoundingClientRect();
      if (rect.width <= 0 || Math.abs(rect.right - event.clientX) > 6) return null;
      return { colIndex: col, x: rect.right };
    };

    const rowBoundaryAt = (event: MouseEvent, cell: HTMLTableCellElement) => {
      const row = Number(cell.dataset.row);
      if (!Number.isFinite(row)) return null;

      const rect = cell.getBoundingClientRect();
      if (rect.height <= 0 || Math.abs(rect.bottom - event.clientY) > 6) return null;
      return { rowIndex: row, y: rect.bottom };
    };

    const startRowResize = (event: MouseEvent, rowIndex: number) => {
      event.preventDefault();
      event.stopPropagation();

      const row = visualRowElements()[rowIndex];
      const tableRect = table.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      if (!row || tableRect.width <= 0) return;

      wrap.classList.add("is-resizing-row");
      clearBrowserSelection();
      const startY = event.clientY;
      const startHeight = row.getBoundingClientRect().height;
      const minHeight = 28;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const nextHeight = Math.max(minHeight, startHeight + moveEvent.clientY - startY);
        rowHeights[rowIndex] = nextHeight;
        row.style.height = `${nextHeight}px`;
        syncTableHandles();
        showHorizontalResizeGuide(row.getBoundingClientRect().bottom);
      };
      const onMouseUp = () => {
        wrap.classList.remove("is-resizing-row");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        syncTableHandles();
        horizontalResizeGuide?.classList.remove("is-visible");
        persistLayoutToSource();
      };

      horizontalResizeGuide?.classList.add("is-visible");
      horizontalResizeGuide!.style.left = `${tableRect.left - frameRect.left}px`;
      horizontalResizeGuide!.style.width = `${tableRect.width}px`;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const makeEditableCell = (
      cell: HTMLTableCellElement,
      value: string,
      rowIndex: number,
      colIndex: number,
      onChange: (nextValue: string) => void,
    ) => {
      cell.contentEditable = "true";
      cell.setAttribute("contenteditable", "true");
      cell.spellcheck = true;
      cell.dataset.row = `${rowIndex}`;
      cell.dataset.col = `${colIndex}`;
      cell.textContent = value;
      renderedCells.set(cellKey(rowIndex, colIndex), cell);

      const updateValue = () => {
        onChange((cell.textContent ?? "").replace(/\s*\n+\s*/g, " "));
      };

      cell.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        const columnBoundary = columnBoundaryAt(event, cell);
        if (columnBoundary) {
          startColumnResize(event, columnBoundary.colIndex);
          return;
        }
        const rowBoundary = rowBoundaryAt(event, cell);
        if (rowBoundary) {
          startRowResize(event, rowBoundary.rowIndex);
          return;
        }
        if (event.shiftKey && lastClickedCell) {
          event.preventDefault();
          draggingTableSelection = false;
          selectionAnchor = null;
          applyTableSelection(lastClickedCell, { row: rowIndex, col: colIndex });
          return;
        }
        setActiveCellHandles(rowIndex, colIndex);
        clearTableSelection();
        selectionAnchor = { row: rowIndex, col: colIndex };
        draggingTableSelection = false;
      });
      const extendSelectionToCell = (event: MouseEvent) => {
        if (!selectionAnchor || event.buttons !== 1) return;
        event.preventDefault();
        draggingTableSelection = true;
        if (wrap.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        clearBrowserSelection();
        applyTableSelection(selectionAnchor, { row: rowIndex, col: colIndex });
      };
      cell.addEventListener("mouseenter", extendSelectionToCell);
      cell.addEventListener("mouseover", extendSelectionToCell);
      cell.addEventListener("mouseup", (event) => {
        if (!selectionAnchor) return;
        lastClickedCell = { row: rowIndex, col: colIndex };
        if (draggingTableSelection) {
          event.preventDefault();
          event.stopPropagation();
          clearBrowserSelection();
          wrap.focus();
        }
        selectionAnchor = null;
        draggingTableSelection = false;
      });
      cell.addEventListener("input", updateValue);
      cell.addEventListener("mousemove", (event) => {
        setActiveCellHandles(rowIndex, colIndex);
        const columnBoundary = columnBoundaryAt(event, cell);
        const rowBoundary = rowBoundaryAt(event, cell);
        cell.classList.toggle("is-column-boundary-hover", !!columnBoundary);
        cell.classList.toggle("is-row-boundary-hover", !!rowBoundary && !columnBoundary);
        if (columnBoundary) showVerticalResizeGuide(columnBoundary.x);
        else verticalResizeGuide?.classList.remove("is-visible");
        if (rowBoundary) showHorizontalResizeGuide(rowBoundary.y);
        else horizontalResizeGuide?.classList.remove("is-visible");
      });
      cell.addEventListener("mouseleave", () => {
        cell.classList.remove("is-column-boundary-hover", "is-row-boundary-hover");
        if (!wrap.classList.contains("is-resizing-column") && !wrap.classList.contains("is-resizing-row")) {
          hideResizeGuides();
        }
      });
      cell.addEventListener("focus", () => {
        setActiveCellHandles(rowIndex, colIndex);
      });
      cell.addEventListener("blur", () => {
        updateValue();
        commitTableEdit();
      });
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          updateValue();
          commitTableEdit();
          cell.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cell.textContent = value;
          updateValue();
          cell.blur();
        }
      });
      cell.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return;
        event.preventDefault();

        const selection = window.getSelection();
        if (!selection?.rangeCount) return;

        selection.deleteFromDocument();
        selection.getRangeAt(0).insertNode(document.createTextNode(text.replace(/\s*\n+\s*/g, " ")));
        selection.collapseToEnd();
        updateValue();
      });
    };

    const finishTableSelection = () => {
      if (selectionAnchor && !draggingTableSelection) lastClickedCell = selectionAnchor;
      selectionAnchor = null;
      draggingTableSelection = false;
    };
    const trackTableSelection = (event: MouseEvent) => {
      if (!selectionAnchor || event.buttons !== 1) return;
      if (typeof document.elementFromPoint !== "function") return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = target?.closest<HTMLTableCellElement>(".cm-md-table-render th, .cm-md-table-render td");
      if (!cell || !wrap.contains(cell)) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      if (row === selectionAnchor.row && col === selectionAnchor.col) return;
      event.preventDefault();
      draggingTableSelection = true;
      if (wrap.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      clearBrowserSelection();
      applyTableSelection(selectionAnchor, { row, col });
    };
    document.addEventListener("mousemove", trackTableSelection);
    document.addEventListener("mousemove", trackAxisHover);
    document.addEventListener("mouseup", finishTableSelection);
    this.cleanup = () => {
      stopColumnResize?.();
      stopAxisDrag?.();
      clearAxisDropTarget();
      clearAxisDragPreview();
      if (activeAxisDrag) setAxisDragSource(activeAxisDrag.kind, activeAxisDrag.index, false);
      wrap.classList.remove("is-dragging-axis");
      window.removeEventListener("resize", syncTableHandles);
      document.removeEventListener("mousemove", trackTableSelection);
      document.removeEventListener("mousemove", trackAxisHover);
      document.removeEventListener("mouseup", finishTableSelection);
    };

    wrap.addEventListener("copy", (event) => {
      if (!selectedRange) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const domSelection = window.getSelection();
      if (activeElement?.closest("[contenteditable='true']") && domSelection && !domSelection.isCollapsed) return;

      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectedTableText());
    });

    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !selectedRange) return;
      clearTableSelection();
    });
    wrap.addEventListener("mouseleave", () => {
      if (wrap.contains(document.activeElement)) return;
      clearActiveCellHandles();
    });
    wrap.addEventListener("focusout", () => {
      requestAnimationFrame(() => {
        if (wrap.contains(document.activeElement)) return;
        clearActiveCellHandles();
      });
    });

    const actions = document.createElement("div");
    actions.className = "cm-md-table-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit source";
    editBtn.addEventListener("mousedown", (event) => event.preventDefault());
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      dispatchPreservingScroll(view, {
        effects: editTableSourceEffect.of({ from: this.table.from, to: this.table.to }),
        selection: EditorSelection.cursor(this.table.from),
      });
      view.focus();
    });
    actions.appendChild(editBtn);

    const rowBtn = document.createElement("button");
    rowBtn.type = "button";
    rowBtn.textContent = "+ Row";
    rowBtn.addEventListener("mousedown", (event) => event.preventDefault());
    rowBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const heights = measuredRowHeights();
      replaceWithTableSource(tableSource(
        draftHeader,
        draftAlignments,
        [...draftRows, draftHeader.map(() => "")],
        persistedLayout({
          colWidths: colWidths.slice(0, draftHeader.length),
          rowHeights: [...heights, heights[heights.length - 1] ?? 43],
        }),
      ));
    });
    actions.appendChild(rowBtn);

    const colBtn = document.createElement("button");
    colBtn.type = "button";
    colBtn.textContent = "+ Column";
    colBtn.addEventListener("mousedown", (event) => event.preventDefault());
    colBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const nextColWidth = 100 / (draftHeader.length + 1);
      const scaledColWidths = colWidths.map((width) => width * (100 - nextColWidth) / 100);
      replaceWithTableSource(tableSource(
        [...draftHeader, `Column ${draftHeader.length + 1}`],
        [...draftAlignments, null],
        draftRows.map((row) => [...row, ""]),
        persistedLayout({
          colWidths: [...scaledColWidths, nextColWidth],
          rowHeights: measuredRowHeights(),
        }),
      ));
    });
    actions.appendChild(colBtn);

    const deleteRowBtn = document.createElement("button");
    deleteRowBtn.type = "button";
    deleteRowBtn.textContent = "- Row";
    deleteRowBtn.title = "Delete the selected row or active data row";
    deleteRowBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteRowBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const rowsToDelete = new Set(selectedDataRowIndexes());
      if (rowsToDelete.size === 0) return;
      replaceWithTableSource(nextTableSource(
        draftHeader,
        draftAlignments,
        draftRows.filter((_, index) => !rowsToDelete.has(index)),
      ));
    });
    actions.appendChild(deleteRowBtn);

    const deleteColBtn = document.createElement("button");
    deleteColBtn.type = "button";
    deleteColBtn.textContent = "- Column";
    deleteColBtn.title = "Delete the selected column or active column";
    deleteColBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteColBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const columnsToDelete = new Set(selectedColumnIndexes());
      if (columnsToDelete.size === 0) return;
      if (columnsToDelete.size >= draftHeader.length) {
        replaceWithTableSource("");
        return;
      }
      replaceWithTableSource(nextTableSource(
        draftHeader.filter((_, index) => !columnsToDelete.has(index)),
        draftAlignments.filter((_, index) => !columnsToDelete.has(index)),
        draftRows.map((row) => row.filter((_, index) => !columnsToDelete.has(index))),
      ));
    });
    actions.appendChild(deleteColBtn);

    const deleteTableBtn = document.createElement("button");
    deleteTableBtn.type = "button";
    deleteTableBtn.textContent = "Delete table";
    deleteTableBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteTableBtn.addEventListener("click", (event) => {
      event.preventDefault();
      replaceWithTableSource("");
    });
    actions.appendChild(deleteTableBtn);

    wrap.appendChild(actions);

    wrap.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button, [contenteditable='true']")) return;
      event.preventDefault();
      view.focus();
    });

    const frame = document.createElement("div");
    frame.className = "cm-md-table-frame";

    axisDragStatus = document.createElement("div");
    axisDragStatus.id = `cm-md-table-drag-status-${tableFrom}`;
    axisDragStatus.className = "cm-md-table-axis-drag-status";
    axisDragStatus.setAttribute("role", "status");
    axisDragStatus.setAttribute("aria-live", "polite");
    frame.appendChild(axisDragStatus);

    axisDropGuide = document.createElement("div");
    axisDropGuide.className = "cm-md-table-axis-drop-guide";
    axisDropGuide.setAttribute("aria-hidden", "true");
    frame.appendChild(axisDropGuide);

    verticalResizeGuide = document.createElement("div");
    verticalResizeGuide.className = "cm-md-table-resize-guide cm-md-table-resize-guide--vertical";
    frame.appendChild(verticalResizeGuide);

    horizontalResizeGuide = document.createElement("div");
    horizontalResizeGuide.className = "cm-md-table-resize-guide cm-md-table-resize-guide--horizontal";
    frame.appendChild(horizontalResizeGuide);

    const columnControls = document.createElement("div");
    columnControls.className = "cm-md-table-column-controls";
    columnHandleElements = [];
    for (let index = 0; index < draftHeader.length; index += 1) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-md-table-axis-handle cm-md-table-column-handle";
      handle.draggable = true;
      handle.dataset.index = `${index}`;
      handle.textContent = "...";
      handle.title = "Drag to move column";
      handle.setAttribute("aria-label", `Move column ${index + 1}`);
      handle.addEventListener("mouseenter", () => setActiveColumnHandle(index));
      handle.addEventListener("focus", () => setActiveColumnHandle(index));
      handle.addEventListener("mousedown", (event) => startAxisDrag(event, "column", index));
      handle.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/plain", `column:${index}`);
        event.dataTransfer.effectAllowed = "move";
        wrap.classList.add("is-dragging-axis");
        setAxisDragSource("column", index, true);
        updateAxisDragPreview("column", index, event.clientX, event.clientY);
      });
      handle.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        updateAxisDragPreview("column", index, event.clientX, event.clientY);
        setAxisDropTarget(handle, axisDropPositionAt(handle, event.clientX, event.clientY));
      });
      handle.addEventListener("dragleave", () => {
        if (activeAxisDropTarget === handle) clearAxisDropTarget();
      });
      handle.addEventListener("drop", (event) => {
        event.preventDefault();
        const [kind, value] = (event.dataTransfer?.getData("text/plain") ?? "").split(":");
        const fromIndex = Number(value);
        const toIndex = destinationIndex(fromIndex, index, activeAxisDropPosition, draftHeader.length);
        clearAxisDropTarget();
        clearAxisDragPreview();
        setAxisDragSource("column", fromIndex, false);
        wrap.classList.remove("is-dragging-axis");
        if (kind !== "column" || !Number.isFinite(fromIndex) || fromIndex === toIndex) return;
        replaceWithTableSource(tableSource(
          moveArray(draftHeader, fromIndex, toIndex),
          moveArray(draftAlignments, fromIndex, toIndex),
          draftRows.map((row) => moveArray(row, fromIndex, toIndex)),
          persistedLayout({
            colWidths: moveArray(colWidths, fromIndex, toIndex),
            rowHeights: measuredRowHeights(),
          }),
        ));
      });
      handle.addEventListener("dragend", () => {
        clearAxisDropTarget();
        clearAxisDragPreview();
        setAxisDragSource("column", index, false);
        wrap.classList.remove("is-dragging-axis");
      });
      columnHandleElements.push(handle);
      columnControls.appendChild(handle);
    }
    frame.appendChild(columnControls);

    const rowControls = document.createElement("div");
    rowControls.className = "cm-md-table-row-controls";
    rowHandleElements = [];
    for (let index = 0; index < draftRows.length + 1; index += 1) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-md-table-axis-handle cm-md-table-row-handle";
      handle.draggable = true;
      handle.dataset.index = `${index}`;
      handle.textContent = "...";
      handle.title = "Drag to move row";
      handle.setAttribute("aria-label", `Move row ${index + 1}`);
      handle.addEventListener("mouseenter", () => setActiveRowHandle(index));
      handle.addEventListener("focus", () => setActiveRowHandle(index));
      handle.addEventListener("mousedown", (event) => startAxisDrag(event, "row", index));
      handle.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/plain", `row:${index}`);
        event.dataTransfer.effectAllowed = "move";
        wrap.classList.add("is-dragging-axis");
        setAxisDragSource("row", index, true);
        updateAxisDragPreview("row", index, event.clientX, event.clientY);
      });
      handle.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        updateAxisDragPreview("row", index, event.clientX, event.clientY);
        setAxisDropTarget(handle, axisDropPositionAt(handle, event.clientX, event.clientY));
      });
      handle.addEventListener("dragleave", () => {
        if (activeAxisDropTarget === handle) clearAxisDropTarget();
      });
      handle.addEventListener("drop", (event) => {
        event.preventDefault();
        const [kind, value] = (event.dataTransfer?.getData("text/plain") ?? "").split(":");
        const fromIndex = Number(value);
        const toIndex = destinationIndex(fromIndex, index, activeAxisDropPosition, draftRows.length + 1);
        clearAxisDropTarget();
        clearAxisDragPreview();
        setAxisDragSource("row", fromIndex, false);
        wrap.classList.remove("is-dragging-axis");
        if (kind !== "row" || !Number.isFinite(fromIndex) || fromIndex === toIndex) return;
        const visualRows = moveArray([draftHeader, ...draftRows], fromIndex, toIndex);
        replaceWithTableSource(tableSource(
          visualRows[0] ?? draftHeader,
          draftAlignments,
          visualRows.slice(1),
          persistedLayout({
            colWidths: colWidths.slice(0, draftHeader.length),
            rowHeights: moveArray(measuredRowHeights(), fromIndex, toIndex),
          }),
        ));
      });
      handle.addEventListener("dragend", () => {
        clearAxisDropTarget();
        clearAxisDragPreview();
        setAxisDragSource("row", index, false);
        wrap.classList.remove("is-dragging-axis");
      });
      rowHandleElements.push(handle);
      rowControls.appendChild(handle);
    }
    frame.appendChild(rowControls);

    const addColumnControl = document.createElement("button");
    addColumnControl.type = "button";
    addColumnControl.className = "cm-md-table-margin-add cm-md-table-add-column";
    addColumnControl.textContent = "+";
    addColumnControl.title = "Add column";
    addColumnControl.setAttribute("aria-label", "Add column");
    addColumnControl.addEventListener("mousedown", (event) => event.preventDefault());
    addColumnControl.addEventListener("click", (event) => {
      event.preventDefault();
      const nextColWidth = 100 / (draftHeader.length + 1);
      const scaledColWidths = colWidths.map((width) => width * (100 - nextColWidth) / 100);
      pendingTableControlRestore = {
        tableFrom,
        rowIndex: activeRowIndex ?? 0,
        colIndex: draftHeader.length,
      };
      replaceWithTableSource(tableSource(
        [...draftHeader, `Column ${draftHeader.length + 1}`],
        [...draftAlignments, null],
        draftRows.map((row) => [...row, ""]),
        persistedLayout({
          colWidths: [...scaledColWidths, nextColWidth],
          rowHeights: measuredRowHeights(),
        }),
      ));
    });
    frame.appendChild(addColumnControl);

    const addRowControl = document.createElement("button");
    addRowControl.type = "button";
    addRowControl.className = "cm-md-table-margin-add cm-md-table-add-row";
    addRowControl.textContent = "+";
    addRowControl.title = "Add row";
    addRowControl.setAttribute("aria-label", "Add row");
    addRowControl.addEventListener("mousedown", (event) => event.preventDefault());
    addRowControl.addEventListener("click", (event) => {
      event.preventDefault();
      const heights = measuredRowHeights();
      pendingTableControlRestore = {
        tableFrom,
        rowIndex: draftRows.length + 1,
        colIndex: activeColIndex ?? 0,
      };
      replaceWithTableSource(tableSource(
        draftHeader,
        draftAlignments,
        [...draftRows, draftHeader.map(() => "")],
        persistedLayout({
          colWidths: colWidths.slice(0, draftHeader.length),
          rowHeights: [...heights, heights[heights.length - 1] ?? 43],
        }),
      ));
    });
    frame.appendChild(addRowControl);

    const table = document.createElement("table");
    const colgroup = document.createElement("colgroup");
    colElements = draftHeader.map(() => {
      const col = document.createElement("col");
      colgroup.appendChild(col);
      return col;
    });
    table.appendChild(colgroup);
    applyColumnWidths();

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [index, cell] of this.table.header.entries()) {
      const th = document.createElement("th");
      makeEditableCell(th, cell, 0, index, (nextValue) => {
        draftHeader[index] = nextValue;
      });
      if (this.table.alignments[index]) th.style.textAlign = this.table.alignments[index]!;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const [rowIndex, row] of this.table.rows.entries()) {
      const tr = document.createElement("tr");
      for (let index = 0; index < this.table.header.length; index += 1) {
        const td = document.createElement("td");
        makeEditableCell(td, row[index] ?? "", rowIndex + 1, index, (nextValue) => {
          draftRows[rowIndex][index] = nextValue;
        });
        if (this.table.alignments[index]) td.style.textAlign = this.table.alignments[index]!;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    for (const [index, row] of [headRow, ...tbody.rows].entries()) {
      if (rowHeights[index]) row.style.height = `${rowHeights[index]}px`;
    }
    frame.appendChild(table);
    wrap.appendChild(frame);

    syncTableHandles = () => {
      const frameRect = frame.getBoundingClientRect();
      const headerCells = [...headRow.cells];
      for (const [index, handle] of columnHandleElements.entries()) {
        const cell = headerCells[index];
        if (!cell) {
          handle.style.display = "none";
          continue;
        }
        const cellRect = cell.getBoundingClientRect();
        handle.style.display = "";
        handle.style.left = `${cellRect.left - frameRect.left}px`;
        handle.style.width = `${cellRect.width}px`;
      }

      const rows = [headRow, ...tbody.rows];
      for (const [index, handle] of rowHandleElements.entries()) {
        const row = rows[index];
        if (!row) {
          handle.style.display = "none";
          continue;
        }
        const rowRect = row.getBoundingClientRect();
        handle.style.display = "";
        handle.style.top = `${rowRect.top - frameRect.top}px`;
        handle.style.height = `${rowRect.height}px`;
      }
    };
    requestAnimationFrame(() => {
      syncTableHandles();
      if (pendingTableControlRestore?.tableFrom !== tableFrom) return;

      const nextRowIndex = pendingTableControlRestore.rowIndex == null
        ? null
        : Math.max(0, Math.min(pendingTableControlRestore.rowIndex, draftRows.length));
      const nextColIndex = pendingTableControlRestore.colIndex == null
        ? null
        : Math.max(0, Math.min(pendingTableControlRestore.colIndex, draftHeader.length - 1));
      setActiveHandles(nextRowIndex, nextColIndex);
      pendingTableControlRestore = null;
    });
    window.addEventListener("resize", syncTableHandles);

    return wrap;
  }

  ignoreEvent(event: Event) {
    const target = event.target as HTMLElement | null;
    return !!target?.closest("button, [contenteditable='true']");
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(private readonly frontmatter: MarkdownFrontmatter) {
    super();
  }

  eq(other: FrontmatterWidget) {
    return this.frontmatter.value === other.frontmatter.value;
  }

  toDOM(view: EditorView) {
    const panel = document.createElement("div");
    panel.className = "cm-md-frontmatter-panel";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "cm-md-frontmatter-header";

    const caret = document.createElement("span");
    caret.className = "cm-md-frontmatter-caret";
    caret.textContent = "▸";
    header.appendChild(caret);

    const label = document.createElement("span");
    label.textContent = "Properties";
    header.appendChild(label);

    const count = document.createElement("span");
    count.className = "cm-md-frontmatter-count";
    count.textContent = `${this.frontmatter.rows.length}`;
    header.appendChild(count);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-frontmatter-edit";
    edit.textContent = "Edit source";
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      selectCursorPreservingScroll(view, this.frontmatter.to);
      view.focus();
    });
    header.appendChild(edit);

    const body = document.createElement("div");
    body.className = "cm-md-frontmatter-body";
    body.hidden = true;

    if (this.frontmatter.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cm-md-frontmatter-empty";
      empty.textContent = "No properties";
      body.appendChild(empty);
    } else {
      for (const row of this.frontmatter.rows) {
        const item = document.createElement("div");
        item.className = "cm-md-frontmatter-row";

        const key = document.createElement("span");
        key.className = "cm-md-frontmatter-key";
        key.textContent = row.key;
        item.appendChild(key);

        const value = document.createElement("span");
        value.className = "cm-md-frontmatter-value";
        value.textContent = row.value || "empty";
        item.appendChild(value);

        body.appendChild(item);
      }
    }

    header.addEventListener("mousedown", (event) => event.preventDefault());
    header.addEventListener("click", () => {
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      view.requestMeasure();
    });

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }
}

class MarkdownImageWidget extends WidgetType {
  constructor(private readonly image: MarkdownImage) {
    super();
  }

  eq(other: MarkdownImageWidget) {
    return this.image.from === other.image.from &&
      this.image.to === other.image.to &&
      this.image.alt === other.image.alt &&
      this.image.src === other.image.src &&
      this.image.title === other.image.title;
  }

  updateDOM(dom: HTMLElement): boolean {
    this.updateFigure(dom, this.image);
    return true;
  }

  private updateFigure(figure: HTMLElement, image: MarkdownImage) {
    figure.dataset.imageFrom = String(image.from);
    figure.dataset.imageTo = String(image.to);
    figure.dataset.imageSrc = image.src;

    const candidates = markdownAssetSrcCandidates(image.src);
    const nextCandidates = JSON.stringify(candidates);
    const img = figure.querySelector("img");
    if (img) {
      if (figure.dataset.imageSrcCandidates !== nextCandidates) {
        figure.dataset.imageSrcCandidates = nextCandidates;
        figure.dataset.imageSrcIndex = "0";
        img.src = candidates[0];
      }
      img.alt = image.alt;
      img.title = image.title || image.alt || image.src;
    }

    const broken = figure.querySelector(".cm-md-image-broken");
    if (broken) {
      broken.textContent = image.src ? `Image not found: ${image.src}` : "Image path is empty";
    }

    let caption = figure.querySelector(".cm-md-image-caption");
    if (image.alt) {
      if (!caption) {
        caption = document.createElement("figcaption");
        caption.className = "cm-md-image-caption";
        figure.appendChild(caption);
      }
      caption.textContent = image.alt;
    } else {
      caption?.remove();
    }
  }

  toDOM(view: EditorView) {
    const figure = document.createElement("figure");
    figure.className = "cm-md-image-render";

    const actions = document.createElement("div");
    actions.className = "cm-md-image-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit source";
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      const imageFrom = Number(figure.dataset.imageFrom);
      const imageTo = Number(figure.dataset.imageTo);
      if (!Number.isFinite(imageFrom) || !Number.isFinite(imageTo)) return;
      view.dispatch({
        effects: editImageSourceEffect.of({ from: imageFrom, to: imageTo }),
        selection: EditorSelection.range(imageFrom, imageTo),
        scrollIntoView: false,
      });
      view.focus();
    });
    actions.appendChild(edit);
    figure.appendChild(actions);

    const img = document.createElement("img");
    img.addEventListener("error", () => {
      const imageSrcCandidates = JSON.parse(figure.dataset.imageSrcCandidates ?? "[]") as string[];
      const imageSrcIndex = Number(figure.dataset.imageSrcIndex ?? "0");
      if (imageSrcIndex < imageSrcCandidates.length - 1) {
        const nextImageSrcIndex = imageSrcIndex + 1;
        figure.dataset.imageSrcIndex = String(nextImageSrcIndex);
        img.src = imageSrcCandidates[nextImageSrcIndex];
        return;
      }
      figure.classList.add("cm-md-image-render--broken");
      view.requestMeasure();
    });
    img.addEventListener("load", () => {
      figure.classList.remove("cm-md-image-render--broken");
      view.requestMeasure();
    });
    figure.appendChild(img);

    const broken = document.createElement("figcaption");
    broken.className = "cm-md-image-broken";
    figure.appendChild(broken);

    figure.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      const imageFrom = Number(figure.dataset.imageFrom);
      const imageTo = Number(figure.dataset.imageTo);
      if (Number.isFinite(imageFrom) && Number.isFinite(imageTo)) {
        const rect = figure.getBoundingClientRect();
        const pos = event.clientX < rect.left + rect.width / 2 ? imageFrom : imageTo;
        view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: false });
      }
      view.focus();
    });

    this.updateFigure(figure, this.image);
    return figure;
  }
}

class CitationWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: CitationWidget) {
    return this.key === other.key && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    const display = citationDisplayForKey(this.key);
    span.className = `cm-md-citation${display.missing ? " cm-md-citation--missing" : ""}`;
    span.textContent = display.label;
    span.title = display.title;
    span.contentEditable = "false";
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectRangePreservingScroll(view, this.from, this.to);
      view.focus();
    });
    return span;
  }
}

class FootnoteReferenceWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: FootnoteReferenceWidget) {
    return this.label === other.label && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const sup = document.createElement("sup");
    sup.className = "cm-md-footnote-ref";
    sup.textContent = this.label;
    sup.title = `Footnote: ${this.label}`;
    sup.contentEditable = "false";
    sup.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectRangePreservingScroll(view, this.from, this.to);
      view.focus();
    });
    return sup;
  }
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(private readonly footnote: MarkdownFootnoteDefinition) {
    super();
  }

  eq(other: FootnoteDefinitionWidget) {
    return (
      this.footnote.from === other.footnote.from &&
      this.footnote.to === other.footnote.to &&
      this.footnote.label === other.footnote.label &&
      this.footnote.value === other.footnote.value
    );
  }

  toDOM(view: EditorView) {
    const item = document.createElement("div");
    item.className = "cm-md-footnote-def";

    const label = document.createElement("sup");
    label.className = "cm-md-footnote-def-label";
    label.textContent = this.footnote.label;
    item.appendChild(label);

    const body = document.createElement("span");
    body.className = "cm-md-footnote-def-body";
    body.textContent = this.footnote.value || "Empty footnote";
    item.appendChild(body);

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectRangePreservingScroll(view, this.footnote.from, this.footnote.to);
      view.focus();
    });

    return item;
  }
}

class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly block: MarkdownHtmlBlock,
  ) {
    super();
  }

  eq(other: HtmlBlockWidget) {
    return this.block.from === other.block.from && this.block.to === other.block.to && this.block.content === other.block.content;
  }

  updateDOM(_dom: HTMLElement): boolean {
    return false;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-html-block-render";
    wrapper.contentEditable = "false";
    wrapper.dataset.htmlFrom = String(this.block.from);
    wrapper.dataset.htmlTo = String(this.block.to);

    const actions = document.createElement("div");
    actions.className = "cm-md-html-block-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "</>";
    editBtn.addEventListener("mousedown", (event) => event.preventDefault());
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const htmlFrom = Number(wrapper.dataset.htmlFrom);
      const htmlTo = Number(wrapper.dataset.htmlTo);
      if (!Number.isFinite(htmlFrom) || !Number.isFinite(htmlTo)) return;
      dispatchPreservingScroll(view, {
        effects: editHtmlBlockEffect.of({ from: htmlFrom, to: htmlTo }),
        selection: EditorSelection.cursor(htmlFrom),
      }, htmlFrom);
      view.focus();
    });
    actions.appendChild(editBtn);
    wrapper.appendChild(actions);

    const inner = document.createElement("div");
    inner.className = "cm-md-html-block-inner";

    const parser = new DOMParser();
    const parsed = parser.parseFromString(this.block.content, "text/html");
    const bodyContent = parsed.body;
    while (bodyContent.firstChild) {
      inner.appendChild(bodyContent.firstChild);
    }

    wrapper.appendChild(inner);

    wrapper.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      const htmlFrom = Number(wrapper.dataset.htmlFrom);
      const htmlTo = Number(wrapper.dataset.htmlTo);
      if (!Number.isFinite(htmlFrom) || !Number.isFinite(htmlTo)) return;
      dispatchPreservingScroll(view, {
        effects: editHtmlBlockEffect.of({ from: htmlFrom, to: htmlTo }),
        selection: EditorSelection.cursor(htmlFrom),
      }, htmlFrom);
      view.focus();
    });

    return wrapper;
  }
}

class HtmlCommentWidget extends WidgetType {
  constructor(
    private readonly content: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: HtmlCommentWidget) {
    return this.content === other.content && this.from === other.from && this.to === other.to;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-html-comment";
    span.contentEditable = "false";
    span.textContent = this.content;
    return span;
  }
}

class HtmlInlineWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: HtmlInlineWidget) {
    return this.source === other.source && this.from === other.from && this.to === other.to;
  }

  updateDOM(_dom: HTMLElement): boolean {
    return true;
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-md-html-inline-render";
    span.contentEditable = "false";

    const parser = new DOMParser();
    const parsed = parser.parseFromString(this.source, "text/html");
    const bodyContent = parsed.body;
    while (bodyContent.firstChild) {
      span.appendChild(bodyContent.firstChild);
    }

    span.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
      event.preventDefault();
      selectRangePreservingScroll(view, this.from, this.to);
      view.focus();
    });

    return span;
  }
}

class MathWidget extends WidgetType {
  constructor(
    private readonly value: string,
    private readonly displayMode: boolean,
    private readonly from: number,
    private readonly to: number,
    private readonly className = "",
  ) {
    super();
  }

  eq(other: MathWidget) {
    return (
      this.value === other.value &&
      this.displayMode === other.displayMode &&
      this.from === other.from &&
      this.to === other.to &&
      this.className === other.className
    );
  }

  toDOM(view: EditorView) {
    const span = document.createElement(this.displayMode ? "div" : "span");
    span.className = [
      "cm-md-math",
      this.displayMode ? "cm-md-math-block-render" : "cm-md-math-inline-render",
      this.className,
    ].filter(Boolean).join(" ");
    if (this.value.trim()) {
      try {
        katex.render(this.value, span, {
          displayMode: this.displayMode,
          throwOnError: false,
          strict: "warn",
          trust: false,
          output: "html",
        });
      } catch (error) {
        span.classList.add("cm-md-math-error");
        span.textContent = error instanceof Error ? error.message : "Invalid math";
      }
    } else {
      span.classList.add("cm-md-math-empty");
    }
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectRangePreservingScroll(view, this.from, this.to);
      view.focus();
    });
    return span;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: HorizontalRuleWidget) {
    return this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const hr = document.createElement("hr");
    hr.className = "cm-md-horizontal-rule";
    hr.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectCursorPreservingScroll(view, this.to);
      view.focus();
    });
    return hr;
  }

  ignoreEvent() {
    return false;
  }
}

class CodeBlockActionsWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(
    private readonly codeBlock: MarkdownCodeBlock,
    private readonly active: boolean,
  ) {
    super();
  }

  eq(other: CodeBlockActionsWidget) {
    return (
      this.codeBlock.from === other.codeBlock.from &&
      this.codeBlock.value === other.codeBlock.value &&
      this.codeBlock.language === other.codeBlock.language &&
      this.active === other.active
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-code-actions-widget";
    if (this.active) wrap.classList.add("is-active");

    const stopMouse = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const languageButton = document.createElement("button");
    languageButton.type = "button";
    languageButton.className = "cm-md-code-action cm-md-code-language";
    languageButton.textContent = this.codeBlock.language || "text";
    languageButton.setAttribute("aria-label", "Change code block language");
    languageButton.title = "Change language";
    languageButton.addEventListener("mousedown", stopMouse);

    const menu = document.createElement("div");
    menu.className = "cm-md-code-language-menu";
    menu.hidden = true;

    const setMenuOpen = (open: boolean) => {
      menu.hidden = !open;
      wrap.classList.toggle("is-open", open);
      if (open) searchInput.focus();
    };

    const applyLanguage = (nextLanguage: string) => {
      const openLine = view.state.doc.lineAt(this.codeBlock.from);
      const open = openLine.text.match(/^(\s*)(`{3,}|~{3,})/);
      if (!open) return;

      const nextOpenLine = `${open[1]}${open[2]}${nextLanguage}`;
      view.dispatch({
        changes: { from: openLine.from, to: openLine.to, insert: nextOpenLine },
        selection: EditorSelection.cursor(openLine.from + nextOpenLine.length),
        scrollIntoView: true,
      });
      view.focus();
    };

    const allLanguages = codeBlockLanguageOptions(this.codeBlock.language);

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cm-md-code-language-search";
    searchInput.placeholder = "Search languages...";
    searchInput.addEventListener("mousedown", stopMouse);
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase();
      for (let i = 1; i < menu.children.length; i++) {
        const child = menu.children[i] as HTMLElement;
        const name = child.textContent?.toLowerCase() || "";
        child.hidden = query.length > 0 && !name.includes(query);
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && searchInput.value) {
        const first = menu.querySelector<HTMLElement>(".cm-md-code-language-option:not([hidden])");
        if (first) {
          first.click();
          return;
        }
      }
      if (event.key === "Escape") setMenuOpen(false);
    });
    menu.appendChild(searchInput);

    for (const language of allLanguages) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `cm-md-code-language-option${language === this.codeBlock.language ? " is-selected" : ""}`;
      item.textContent = language || "Plain text";
      item.addEventListener("mousedown", stopMouse);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        applyLanguage(language);
      });
      menu.appendChild(item);
    }

    languageButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(menu.hidden);
    });
    wrap.appendChild(languageButton);
    wrap.appendChild(menu);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "cm-md-code-action cm-md-code-copy";
    copyButton.textContent = "⧉";
    copyButton.setAttribute("aria-label", "Copy code");
    copyButton.title = "Copy code";
    copyButton.addEventListener("mousedown", stopMouse);
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigator.clipboard?.writeText(this.codeBlock.value).then(() => {
        copyButton.textContent = "✓";
        window.setTimeout(() => {
          copyButton.textContent = "⧉";
        }, 900);
      }).catch(() => {
        copyButton.textContent = "!";
        window.setTimeout(() => {
          copyButton.textContent = "⧉";
        }, 1100);
      });
    });
    wrap.appendChild(copyButton);

    const syncHover = (event: MouseEvent) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      wrap.classList.toggle("is-hovered", pos !== null && pos >= this.codeBlock.from && pos <= this.codeBlock.to);
    };
    const clearHover = () => wrap.classList.remove("is-hovered");
    const closeOnOutside = (event: MouseEvent) => {
      if (!wrap.contains(event.target as Node)) setMenuOpen(false);
    };

    view.scrollDOM.addEventListener("mousemove", syncHover);
    view.scrollDOM.addEventListener("mouseleave", clearHover);
    window.addEventListener("mousedown", closeOnOutside, true);
    this.cleanup = () => {
      view.scrollDOM.removeEventListener("mousemove", syncHover);
      view.scrollDOM.removeEventListener("mouseleave", clearHover);
      window.removeEventListener("mousedown", closeOnOutside, true);
    };

    return wrap;
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }

  ignoreEvent() {
    return false;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly kind: "bullet" | "ordered",
    private readonly label = "",
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return this.kind === other.kind && this.label === other.label;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-list-marker cm-md-list-marker--${this.kind}`;
    span.textContent = this.kind === "ordered" ? `${this.label} ` : "";
    return span;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerFrom: number,
    private readonly markerTo: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return this.checked === other.checked && this.markerFrom === other.markerFrom && this.markerTo === other.markerTo;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-md-task-checkbox${this.checked ? " is-checked" : ""}`;
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    button.setAttribute("aria-checked", String(this.checked));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = this.checked ? " " : "x";
      const selection = view.state.selection;
      view.dispatch({
        changes: { from: this.markerFrom + 3, to: this.markerFrom + 4, insert: next },
        selection,
      });
    });
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

function addInlineDecorations(
  ranges: DecorationRange[],
  lineText: string,
  lineFrom: number,
  fromOffset: number,
  cursorFrom: number,
  cursorTo: number,
) {
  const re = /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~|`([^`\n]+?)`|\[([^\]\n]+?)\]\(([^)\n]+?)\)|\[([^\]\n]+?)\]\[([^\]\n]*)\]|_([^_\n]+?)_|\*([^*\n]+?)\*|\\([\\`*{}[\]()#+\-.!|>])|<([a-zA-Z]+:\/\/[^\s>]+)>|<([a-zA-Z][a-zA-Z0-9.]+@[a-zA-Z0-9.]+)>|\[([^\]\n]*)\]:\s*<?([^>\s]+)>?\s*$/g;
  re.lastIndex = fromOffset;

  let match: RegExpExecArray | null;
  while ((match = re.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;

    if (match[1] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 3, active));
      ranges.push({ from: start + 3, to: end - 3, className: "cm-md-bold cm-md-italic" });
      ranges.push(markerRange(end - 3, end, active));
    } else if (match[2] !== undefined || match[3] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 2, active));
      ranges.push({ from: start + 2, to: end - 2, className: "cm-md-bold" });
      ranges.push(markerRange(end - 2, end, active));
    } else if (match[4] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 2, active));
      ranges.push({ from: start + 2, to: end - 2, className: "cm-md-strike" });
      ranges.push(markerRange(end - 2, end, active));
    } else if (match[5] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-code" });
      ranges.push(markerRange(end - 1, end, active));
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const labelEnd = start + 1 + match[6].length;
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active, "cm-md-active-link-marker"));
      ranges.push({ from: start + 1, to: labelEnd, className: "cm-md-link" });
      ranges.push(markerRange(labelEnd, end, active, "cm-md-active-link-marker"));
    } else if (match[8] !== undefined && match[9] !== undefined) {
      const labelEnd = start + 1 + match[8].length;
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active, "cm-md-active-link-marker"));
      ranges.push({ from: start + 1, to: labelEnd, className: "cm-md-link" });
      ranges.push(markerRange(labelEnd, end, active, "cm-md-active-link-marker"));
    } else if (match[10] !== undefined || match[11] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-italic" });
      ranges.push(markerRange(end - 1, end, active));
    } else if (match[12] !== undefined) {
      ranges.push({ from: start + 1, to: end, className: "cm-md-escape" });
    } else if (match[13] !== undefined) {
      ranges.push(markerRange(start, start + 1, false, "cm-md-active-link-marker"));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-link" });
      ranges.push(markerRange(end - 1, end, false, "cm-md-active-link-marker"));
    } else if (match[14] !== undefined) {
      ranges.push(markerRange(start, start + 1, false, "cm-md-active-link-marker"));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-link" });
      ranges.push(markerRange(end - 1, end, false, "cm-md-active-link-marker"));
    } else if (match[15] !== undefined) {
      ranges.push({ from: start, to: end, className: "cm-md-link cm-md-ref-definition" });
    }
  }

  for (const math of inlineMathRanges(lineText, lineFrom, fromOffset)) {
    const overlapsInlineCode = ranges.some((range) => (
      range.className?.includes("cm-md-code") &&
      range.from < math.to &&
      range.to > math.from
    ));
    if (overlapsInlineCode) continue;

    const active = inlineMarkerActive([{ from: math.from, to: math.to }], cursorFrom, cursorTo);
    if (active) {
      const source = lineText.slice(math.from - lineFrom, math.to - lineFrom);
      const contentStart = source.startsWith("\\(") ? 2 : 1;
      const contentEnd = source.endsWith("\\)") ? source.length - 2 : source.length - 1;
      ranges.push({
        from: math.from,
        to: math.from + contentStart,
        className: "cm-md-marker cm-md-marker--active cm-md-math-delimiter",
      });
      if (contentEnd > contentStart) {
        ranges.push({
          from: math.from + contentStart,
          to: math.from + contentEnd,
          className: "cm-md-math-source",
        });
        addLatexSyntaxTokenDecorations(
          ranges,
          source.slice(contentStart, contentEnd),
          math.from + contentStart,
        );
      }
      ranges.push({
        from: math.from + contentEnd,
        to: math.to,
        className: "cm-md-marker cm-md-marker--active cm-md-math-delimiter",
      });
    } else {
      ranges.push({
        from: math.from,
        to: math.to,
        replace: true,
        widget: new MathWidget(math.value, false, math.from, math.to),
      });
    }
  }

  const citeRe = /\[@([^\]\n]+)\]/g;
  citeRe.lastIndex = fromOffset;
  while ((match = citeRe.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
    if (active) {
      ranges.push({ from: start, to: end, className: "cm-md-citation-source" });
    } else {
      ranges.push({
        from: start,
        to: end,
        replace: true,
        widget: new CitationWidget(match[1].trim(), start, end),
      });
    }
  }

  const footnoteRefRe = /\[\^([^\]\n]+)\]/g;
  footnoteRefRe.lastIndex = fromOffset;
  while ((match = footnoteRefRe.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
    if (active) {
      ranges.push({ from: start, to: end, className: "cm-md-footnote-source" });
    } else {
      ranges.push({
        from: start,
        to: end,
        replace: true,
        widget: new FootnoteReferenceWidget(match[1].trim(), start, end),
      });
    }
  }

  const emojiRe = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|\p{Regional_Indicator}{2}/gu;
  emojiRe.lastIndex = fromOffset;
  while ((match = emojiRe.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    ranges.push({ from: start, to: end, className: "cm-md-emoji" });
  }

  const htmlCommentRe = /<!--[\s\S]*?-->/g;
  htmlCommentRe.lastIndex = fromOffset;
  const commentRanges: { from: number; to: number }[] = [];
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = htmlCommentRe.exec(lineText)) !== null) {
    const commentStart = lineFrom + commentMatch.index;
    const commentEnd = commentStart + commentMatch[0].length;
    commentRanges.push({ from: commentStart, to: commentEnd });
    ranges.push({
      from: commentStart,
      to: commentEnd,
      replace: true,
      widget: new HtmlCommentWidget(commentMatch[0], commentStart, commentEnd),
    });
  }

  const htmlTagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*?)?)\s*>/g;
  htmlTagRe.lastIndex = fromOffset;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlTagRe.exec(lineText)) !== null) {
    const tagName = htmlMatch[1].toLowerCase();
    const selfClosing = htmlMatch[0].endsWith("/>");
    const voidTag = voidHtmlTagNames.has(tagName);
    const inlineTag = inlineHtmlTagNames.has(tagName);

    if (!selfClosing && !voidTag && !inlineTag) continue;

    const tagStart = lineFrom + htmlMatch.index;
    const tagMatchEnd = tagStart + htmlMatch[0].length;

    if (commentRanges.some((cr) => tagStart < cr.to && tagMatchEnd > cr.from)) continue;

    if (selfClosing || voidTag) {
      const active = inlineMarkerActive([{ from: tagStart, to: tagMatchEnd }], cursorFrom, cursorTo);
      if (active) {
        ranges.push({ from: tagStart, to: tagMatchEnd, className: "cm-md-html-source" });
      } else {
        const source = lineText.slice(htmlMatch.index, htmlMatch.index + htmlMatch[0].length);
        ranges.push({
          from: tagStart,
          to: tagMatchEnd,
          replace: true,
          widget: new HtmlInlineWidget(source, tagStart, tagMatchEnd),
        });
      }
      continue;
    }

    const closeRe = new RegExp(`<\\/${tagName}\\s*>`, "i");
    const afterOpen = lineText.slice(htmlMatch.index + htmlMatch[0].length);
    const closeMatch = closeRe.exec(afterOpen);
    if (!closeMatch) continue;

    const closeStart = htmlMatch.index + htmlMatch[0].length + closeMatch.index;
    const endPos = lineFrom + closeStart + closeMatch[0].length;
    const source = lineText.slice(htmlMatch.index, closeStart + closeMatch[0].length);
    const active = inlineMarkerActive([{ from: tagStart, to: endPos }], cursorFrom, cursorTo);

    if (active) {
      ranges.push({ from: tagStart, to: endPos, className: "cm-md-html-source" });
    } else {
      ranges.push({
        from: tagStart,
        to: endPos,
        replace: true,
        widget: new HtmlInlineWidget(source, tagStart, endPos),
      });
    }

    htmlTagRe.lastIndex = closeStart + closeMatch[0].length;
  }
}

function linkAtPosition(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const fullLinkRe = /!?\[([^\]\n]+?)\]\(([^)\s]+)(?:\s+"[^"]+")?\)/g;
  const refLinkRe = /!?\[([^\]\n]+?)\]\[([^\]\n]*)\]/g;
  const refDefRe = /\[[^\]\n]*\]:\s*<?([^>\s]+)>?\s*$/g;
  const autolinkRe = /<([a-zA-Z][a-zA-Z0-9.]+@[a-zA-Z0-9.]+|[a-zA-Z]+:\/\/[^\s>]+)>/g;
  let match: RegExpExecArray | null;

  while ((match = fullLinkRe.exec(line.text)) !== null) {
    if (match[0].startsWith("!")) continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to, href: match[2] };
  }

  while ((match = refLinkRe.exec(line.text)) !== null) {
    if (match[0].startsWith("!")) continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      return { from, to, href: `[${match[2]}]` };
    }
  }

  while ((match = autolinkRe.exec(line.text)) !== null) {
    const href = match[1].startsWith("http") || match[1].startsWith("ftp")
      ? match[1]
      : `mailto:${match[1]}`;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to, href };
  }

  while ((match = refDefRe.exec(line.text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to, href: match[1] };
  }

  return null;
}

function imageOnLineAtPosition(state: EditorState, pos: number) {
  const doc = state.doc;
  const safePos = Math.max(0, Math.min(pos, doc.length));
  const line = doc.lineAt(safePos);
  return imageAtLine(line.text, line.from);
}

function deleteImageAtCursor(view: EditorView, direction: "backward" | "forward") {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const image = imageOnLineAtPosition(view.state, selection.from);
  if (!image) return false;
  const atDeleteEdge = direction === "backward"
    ? selection.from === image.to
    : selection.from === image.from;
  if (!atDeleteEdge) return false;

  view.dispatch({
    changes: { from: image.from, to: image.to },
    selection: EditorSelection.cursor(image.from),
    scrollIntoView: true,
  });
  return true;
}

function markdownDecorationLineRanges(state: EditorState, ranges?: readonly DecorationBuildRange[]) {
  const doc = state.doc;
  if (!ranges || ranges.length === 0) return [{ fromLine: 1, toLine: doc.lines }];

  const lineRanges = ranges.map((range) => {
    const fromLine = doc.lineAt(Math.max(0, Math.min(range.from, doc.length))).number;
    const toLine = doc.lineAt(Math.max(0, Math.min(range.to, doc.length))).number;
    return {
      fromLine: Math.max(1, fromLine - inlineDecorationContextLineCount),
      toLine,
    };
  }).sort((a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine);

  const merged: Array<{ fromLine: number; toLine: number }> = [];
  for (const range of lineRanges) {
    const previous = merged[merged.length - 1];
    if (previous && range.fromLine <= previous.toLine + 1) {
      previous.toLine = Math.max(previous.toLine, range.toLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function externalInsertRange(view: EditorView, text: string) {
  const selection = view.state.selection.main;
  if (!selection.empty || !text.startsWith("\n")) {
    return { from: selection.from, to: selection.to };
  }

  const link = linkAtPosition(view, selection.from);
  return link ? { from: link.to, to: link.to } : { from: selection.from, to: selection.to };
}

function rangesIntersect(a: DecorationBuildRange, b: DecorationBuildRange) {
  return a.from <= b.to && b.from <= a.to;
}

function mergeDecorationBuildRanges(ranges: DecorationBuildRange[]) {
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: DecorationBuildRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function lineRangeToBuildRange(state: EditorState, fromLine: number, toLine: number): DecorationBuildRange {
  const doc = state.doc;
  const safeFromLine = Math.max(1, Math.min(fromLine, doc.lines));
  const safeToLine = Math.max(safeFromLine, Math.min(toLine, doc.lines));
  return {
    from: doc.line(safeFromLine).from,
    to: doc.line(safeToLine).to,
  };
}

function expandLayoutDirtyRange(state: EditorState, from: number, to: number): DecorationBuildRange {
  const doc = state.doc;
  if (doc.length === 0) return { from: 0, to: 0 };

  const safeFrom = Math.max(0, Math.min(from, doc.length));
  const safeTo = Math.max(safeFrom, Math.min(to, doc.length));
  const changedFromLine = doc.lineAt(safeFrom).number;
  const changedToLine = doc.lineAt(safeTo).number;
  let dirty = lineRangeToBuildRange(
    state,
    changedFromLine - layoutDecorationContextLineCount,
    changedToLine + layoutDecorationContextLineCount,
  );

  const expandTo = (range: DecorationBuildRange | null | undefined) => {
    if (!range || !rangesIntersect(dirty, range)) return;
    dirty = {
      from: Math.min(dirty.from, range.from),
      to: Math.max(dirty.to, range.to),
    };
  };

  if (frontmatterAtTop(state)) expandTo(frontmatterAtTop(state) ?? undefined);

  const scanFrom = doc.lineAt(dirty.from).number;
  const scanTo = doc.lineAt(dirty.to).number;
  for (let lineNumber = scanFrom; lineNumber <= scanTo; lineNumber += 1) {
    const line = doc.line(lineNumber);
    expandTo(mathBlockAt(state, lineNumber));
    expandTo(codeBlockAt(state, lineNumber));
    expandTo(imageAtLine(line.text, line.from));
    expandTo(htmlCommentAt(state, lineNumber));
    expandTo(htmlBlockAt(state, lineNumber));
    expandTo(footnoteDefinitionAt(state, lineNumber));
    expandTo(tableAt(doc, lineNumber));
  }

  return dirty;
}

function layoutDirtyRangesForTransaction(transaction: Transaction) {
  const ranges: DecorationBuildRange[] = [];
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push(expandLayoutDirtyRange(transaction.state, fromB, toB));
  });
  return mergeDecorationBuildRanges(ranges);
}

function decorationRangesToSet(ranges: DecorationRange[]) {
  const decorations: Range<Decoration>[] = [];
  for (const range of ranges) {
    if (range.point && range.widget) {
      decorations.push(
        Decoration.widget({ widget: range.widget, block: range.block, side: range.side })
          .range(range.from),
      );
    } else if (range.line && range.className) {
      decorations.push(Decoration.line({ class: range.className }).range(range.from));
    } else if (range.from < range.to) {
      decorations.push(
        (range.replace
          ? Decoration.replace({ widget: range.widget, block: range.block })
          : Decoration.mark({ class: range.className }))
          .range(range.from, range.to),
      );
    }
  }
  return Decoration.set(decorations, true);
}

function buildMarkdownDecorations(state: EditorState, options: MarkdownDecorationBuildOptions = {}) {
  const includeLayout = options.includeLayout ?? true;
  const includeInline = options.includeInline ?? true;
  const showActiveInline = !options.suppressActiveInline;
  const ranges: DecorationRange[] = [];
  const pushLayout = (range: DecorationRange) => {
    if (includeLayout) ranges.push(range);
  };
  const pushInline = (range: DecorationRange) => {
    if (includeInline) ranges.push(range);
  };
  const addInline = (
    text: string,
    lineFrom: number,
    fromOffset: number,
    selectionFrom: number,
    selectionTo: number,
  ) => {
    if (includeInline) addInlineDecorations(ranges, text, lineFrom, fromOffset, selectionFrom, selectionTo);
  };
  const addSyntax = (lineText: string, lineFrom: number, language: string) => {
    if (includeInline) addSyntaxTokenDecorations(ranges, lineText, lineFrom, language);
  };
  const addLatexSyntax = (lineText: string, lineFrom: number) => {
    if (includeInline) addLatexSyntaxTokenDecorations(ranges, lineText, lineFrom);
  };
  const selection = options.selectionOverride ?? state.selection.main;
  const cursorFrom = selection.from;
  const cursorTo = selection.to;
  const selectionEmpty = selection.from === selection.to;
  const doc = state.doc;
  const enableCodeSyntaxHighlighting = doc.length <= codeSyntaxHighlightMaxDocLength;
  const frontmatter = frontmatterAtTop(state);
  const tableSourceEditRange = state.field(tableSourceEditRangeField, false);
  const imageSourceEditRange = state.field(imageSourceEditRangeField, false);
  const htmlBlockEditRange = state.field(htmlBlockEditRangeField, false);
  const lineRanges = markdownDecorationLineRanges(state, options.ranges);

  for (const lineRange of lineRanges) {
    for (let lineNumber = lineRange.fromLine; lineNumber <= lineRange.toLine; lineNumber += 1) {
      const line = doc.line(lineNumber);
    const text = line.text;

    if (frontmatter && line.from === frontmatter.from) {
      const activeFrontmatter = showActiveInline && selectionEmpty && cursorTo >= frontmatter.from && cursorFrom <= frontmatter.to;
      const lastFrontmatterLineNumber = doc.lineAt(frontmatter.to).number;
      if (activeFrontmatter) {
        for (let fmLineNumber = line.number; fmLineNumber <= lastFrontmatterLineNumber; fmLineNumber += 1) {
          const fmLine = doc.line(fmLineNumber);
          pushInline({ from: fmLine.from, to: fmLine.to, className: "cm-md-frontmatter-source" });
        }
      } else {
        pushLayout({
          from: frontmatter.from,
          to: frontmatter.to,
          replace: true,
          block: true,
          widget: new FrontmatterWidget(frontmatter),
        });
      }

      lineNumber = lastFrontmatterLineNumber;
      continue;
    }

    const mathBlock = mathBlockAt(state, line.number);
    if (mathBlock) {
      const activeMathBlock = showActiveInline && rangeActive(mathBlock, cursorFrom, cursorTo, selectionEmpty);
      const lastMathLineNumber = doc.lineAt(mathBlock.to).number;
      if (activeMathBlock) {
        for (let mathLineNumber = line.number; mathLineNumber <= lastMathLineNumber; mathLineNumber += 1) {
          const mathLine = doc.line(mathLineNumber);
          pushInline({ from: mathLine.from, to: mathLine.to, className: "cm-md-math-source" });
          addLatexSyntax(mathLine.text, mathLine.from);
        }
        pushLayout({
          from: mathBlock.to,
          to: mathBlock.to,
          point: true,
          block: true,
          side: 1,
          widget: new MathWidget(
            mathBlock.value,
            true,
            mathBlock.from,
            mathBlock.to,
            "cm-md-math-block-live-preview",
          ),
        });
      } else {
        pushLayout({
          from: mathBlock.from,
          to: mathBlock.to,
          replace: true,
          block: true,
          widget: new MathWidget(mathBlock.value, true, mathBlock.from, mathBlock.to),
        });
      }

      lineNumber = lastMathLineNumber;
      continue;
    }

    const codeBlock = codeBlockAt(state, line.number);
    if (codeBlock) {
      const activeCodeBlock = showActiveInline && selectionEmpty && cursorTo >= codeBlock.from && cursorFrom <= codeBlock.to;
      const lastCodeLineNumber = doc.lineAt(codeBlock.to).number;

      for (let codeLineNumber = line.number; codeLineNumber <= lastCodeLineNumber; codeLineNumber += 1) {
        const codeLine = doc.line(codeLineNumber);
        const isOpenFenceLine = codeLineNumber === line.number;
        const isCloseFenceLine = codeBlock.closed && codeLineNumber === lastCodeLineNumber;
        const isFenceLine = isOpenFenceLine || isCloseFenceLine;
        const isFirstLine = codeLineNumber === line.number;
        const isLastLine = codeLineNumber === lastCodeLineNumber;

        const lineClasses = [
          "cm-md-code-block-line",
          isFirstLine ? "cm-md-code-block-line--first" : "",
          isLastLine ? "cm-md-code-block-line--last" : "",
        ].filter(Boolean).join(" ");
        pushLayout({ from: codeLine.from, to: codeLine.from, line: true, className: lineClasses });
        if (isFenceLine && !activeCodeBlock) {
          pushInline({ from: codeLine.from, to: codeLine.to, className: "cm-md-code-fence-hidden" });
        } else {
          pushInline({ from: codeLine.from, to: codeLine.to, className: "cm-md-code-block-source" });
        }
        if (isOpenFenceLine) {
          pushInline({
            from: codeLine.from,
            to: codeLine.from,
            point: true,
            side: 1,
            widget: new CodeBlockActionsWidget(codeBlock, activeCodeBlock),
          });
        }
        if (!isFenceLine && enableCodeSyntaxHighlighting) {
          addSyntax(codeLine.text, codeLine.from, codeBlock.language);
        }
      }

      lineNumber = lastCodeLineNumber;
      continue;
    }

    const image = imageAtLine(text, line.from);
    if (image) {
      const activeImage = !!imageSourceEditRange && imageSourceEditRange.to >= image.from && imageSourceEditRange.from <= image.to;
      if (activeImage) {
        pushInline({ from: image.from, to: image.to, className: "cm-md-image-source" });
      } else {
        pushLayout({
          from: image.from,
          to: image.to,
          replace: true,
          block: true,
          widget: new MarkdownImageWidget(image),
        });
      }
      continue;
    }

    const htmlComment = htmlCommentAt(state, line.number);
    if (htmlComment) {
      const lastCommentLineNumber = doc.lineAt(htmlComment.to).number;
      pushLayout({
        from: htmlComment.from,
        to: htmlComment.to,
        replace: true,
        widget: new HtmlCommentWidget(doc.sliceString(htmlComment.from, htmlComment.to), htmlComment.from, htmlComment.to),
      });
      lineNumber = lastCommentLineNumber;
      continue;
    }

    const htmlBlock = htmlBlockAt(state, line.number);
    if (htmlBlock) {
      const activeHtmlBlock = !!htmlBlockEditRange && htmlBlockEditRange.to >= htmlBlock.from && htmlBlockEditRange.from <= htmlBlock.to;
      const lastHtmlLineNumber = doc.lineAt(htmlBlock.to).number;
      if (activeHtmlBlock) {
        for (let htmlLineNumber = line.number; htmlLineNumber <= lastHtmlLineNumber; htmlLineNumber += 1) {
          const htmlLine = doc.line(htmlLineNumber);
          pushInline({ from: htmlLine.from, to: htmlLine.to, className: "cm-md-html-source" });
        }
      } else {
        pushLayout({
          from: htmlBlock.from,
          to: htmlBlock.to,
          replace: true,
          block: true,
          widget: new HtmlBlockWidget(htmlBlock),
        });
      }

      lineNumber = lastHtmlLineNumber;
      continue;
    }

    const footnoteDefinition = footnoteDefinitionAt(state, line.number);
    if (footnoteDefinition) {
      const activeFootnote = showActiveInline && rangeActive(footnoteDefinition, cursorFrom, cursorTo, selectionEmpty);
      const lastFootnoteLineNumber = doc.lineAt(footnoteDefinition.to).number;
      if (activeFootnote) {
        for (let footnoteLineNumber = line.number; footnoteLineNumber <= lastFootnoteLineNumber; footnoteLineNumber += 1) {
          const footnoteLine = doc.line(footnoteLineNumber);
          pushInline({ from: footnoteLine.from, to: footnoteLine.to, className: "cm-md-footnote-source" });
        }
      } else {
        pushLayout({
          from: footnoteDefinition.from,
          to: footnoteDefinition.to,
          replace: true,
          block: true,
          widget: new FootnoteDefinitionWidget(footnoteDefinition),
        });
      }

      lineNumber = lastFootnoteLineNumber;
      continue;
    }

    const table = tableAt(doc, line.number);
    if (table) {
      const activeTable = !!tableSourceEditRange && tableSourceEditRange.to >= table.from && tableSourceEditRange.from <= table.to;
      const lastTableLineNumber = doc.lineAt(table.to).number;
      if (activeTable) {
        for (let tableLineNumber = line.number; tableLineNumber <= lastTableLineNumber; tableLineNumber += 1) {
          const tableLine = doc.line(tableLineNumber);
          pushInline({ from: tableLine.from, to: tableLine.to, className: "cm-md-table-source" });
        }
      } else {
        pushLayout({
          from: table.from,
          to: table.to,
          replace: true,
          block: true,
          widget: new MarkdownTableWidget(table),
        });
      }

      lineNumber = lastTableLineNumber;
      continue;
    }

    const isDefaultCursor = cursorFrom === 0 && cursorTo === 0 && selectionEmpty;
    const activeLine = showActiveInline && selectionEmpty && (!isDefaultCursor || options.allowDefaultCursor === true)
      && cursorTo >= line.from && cursorFrom <= line.to;
    const heading = text.match(/^(#{1,6})\s+/);
    const blockquote = text.match(/^((?:>\s*)+)/);
    const task = text.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+/);
    const unordered = text.match(/^(\s*)([-*+])\s+/);
    const ordered = text.match(/^(\s*)(\d+\.)\s+/);

    if (heading) {
      const level = Math.min(heading[1].length, 6);
      pushLayout({ from: line.from, to: line.from, line: true, className: `cm-md-heading-line cm-md-hl-${level}` });
      pushInline(markerRange(line.from, line.from + heading[0].length, activeLine, `cm-heading-marker-${level}`));
      pushInline({ from: line.from + heading[0].length, to: line.to, className: `cm-md-heading cm-md-h${level}` });
      addInline(text, line.from, heading[0].length, cursorFrom, cursorTo);
    } else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(text)) {
      if (activeLine) {
        pushInline({ from: line.from, to: line.to, className: "cm-md-rule-source" });
      } else {
        pushLayout({
          from: line.from,
          to: line.to,
          replace: true,
          block: true,
          widget: new HorizontalRuleWidget(line.from, line.to),
        });
      }
    } else if (blockquote) {
      const blockquotePrefix = blockquote[1];
      const blockquoteLevel = (blockquotePrefix.match(/>/g) || []).length;
      const contentAfterPrefix = text.slice(blockquotePrefix.length);

      pushLayout({ from: line.from, to: line.from, line: true, className: `cm-md-blockquote-line cm-md-blockquote-level-${blockquoteLevel}` });
      pushInline(markerRange(line.from, line.from + blockquotePrefix.length, activeLine));

      const contentFrom = line.from + blockquotePrefix.length;
      const contentHeading = contentAfterPrefix.match(/^(#{1,6})\s+/);
      const contentTask = contentAfterPrefix.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+/);
      const contentUnordered = contentAfterPrefix.match(/^(\s*)([-*+])\s+/);
      const contentOrdered = contentAfterPrefix.match(/^(\s*)(\d+\.)\s+/);

      if (contentHeading) {
        const level = Math.min(contentHeading[1].length, 6);
        pushInline({ from: contentFrom, to: contentFrom + contentHeading[0].length, className: `cm-md-heading-marker cm-md-h${level}` });
        pushInline({ from: contentFrom + contentHeading[0].length, to: line.to, className: `cm-md-heading cm-md-h${level} cm-md-blockquote` });
      } else if (contentTask) {
        const markerFrom = contentFrom + contentTask[1].length;
        const markerTo = contentFrom + contentTask[0].length;
        const activeTaskMarker = cursorTo >= markerFrom && cursorFrom <= markerTo;
        if (activeTaskMarker) {
          pushInline(markerRange(markerFrom, markerTo, true));
        } else {
          pushInline({
            from: markerFrom,
            to: markerTo,
            replace: true,
            widget: new TaskCheckboxWidget(contentTask[3].toLowerCase() === "x", markerFrom, markerTo),
          });
        }
        if (contentTask[3].toLowerCase() === "x") {
          pushInline({ from: markerTo, to: line.to, className: "cm-md-task-complete cm-md-blockquote" });
        }
        pushInline({ from: markerTo, to: line.to, className: "cm-md-blockquote" });
        addInline(text, contentFrom, contentTask[0].length, cursorFrom, cursorTo);
      } else if (contentUnordered) {
        const markerFrom = contentFrom + contentUnordered[1].length;
        const markerTo = contentFrom + contentUnordered[0].length;
        pushInline({
          from: markerFrom,
          to: markerTo,
          replace: true,
          widget: new ListMarkerWidget("bullet"),
        });
        pushInline({ from: markerTo, to: line.to, className: "cm-md-blockquote" });
        addInline(text, contentFrom, contentUnordered[0].length, cursorFrom, cursorTo);
      } else if (contentOrdered) {
        const markerFrom = contentFrom + contentOrdered[1].length;
        const markerTo = contentFrom + contentOrdered[0].length;
        pushInline({
          from: markerFrom,
          to: markerTo,
          replace: true,
          widget: new ListMarkerWidget("ordered", contentOrdered[2]),
        });
        pushInline({ from: markerTo, to: line.to, className: "cm-md-blockquote" });
        addInline(text, contentFrom, contentOrdered[0].length, cursorFrom, cursorTo);
      } else {
        pushInline({ from: contentFrom, to: line.to, className: "cm-md-blockquote" });
        addInline(text, contentFrom, 0, cursorFrom, cursorTo);
      }
    } else if (task) {
      const taskIndent = Math.floor(task[1].length / 2);
      pushLayout({ from: line.from, to: line.from, line: true, className: `cm-md-indent-${taskIndent}` });
      const markerFrom = line.from + task[1].length;
      const markerTo = line.from + task[0].length;
      const activeTaskMarker = cursorTo >= markerFrom && cursorFrom <= markerTo;
      if (activeTaskMarker) {
        pushInline(markerRange(markerFrom, markerTo, true));
      } else {
        pushInline({
          from: markerFrom,
          to: markerTo,
          replace: true,
          widget: new TaskCheckboxWidget(task[3].toLowerCase() === "x", markerFrom, markerTo),
        });
      }
      if (task[3].toLowerCase() === "x") {
        pushInline({ from: markerTo, to: line.to, className: "cm-md-task-complete" });
      }
      addInline(text, line.from, task[0].length, cursorFrom, cursorTo);
    } else if (unordered) {
      const unorderedIndent = Math.floor(unordered[1].length / 2);
      pushLayout({ from: line.from, to: line.from, line: true, className: `cm-md-indent-${unorderedIndent}` });
      pushInline({
        from: line.from + unordered[1].length,
        to: line.from + unordered[0].length,
        replace: true,
        widget: new ListMarkerWidget("bullet"),
      });
      addInline(text, line.from, unordered[0].length, cursorFrom, cursorTo);
    } else if (ordered) {
      const orderedIndent = Math.floor(ordered[1].length / 2);
      pushLayout({ from: line.from, to: line.from, line: true, className: `cm-md-indent-${orderedIndent}` });
      pushInline({
        from: line.from + ordered[1].length,
        to: line.from + ordered[0].length,
        replace: true,
        widget: new ListMarkerWidget("ordered", ordered[2]),
      });
      addInline(text, line.from, ordered[0].length, cursorFrom, cursorTo);
    } else {
      addInline(text, line.from, 0, cursorFrom, cursorTo);
    }
    }
  }

  return decorationRangesToSet(ranges);
}

function buildMarkdownImageAtomicRanges(state: EditorState) {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  const imageAtom = Decoration.mark({});
  const imageSourceEditRange = state.field(imageSourceEditRangeField, false);
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const image = imageAtLine(line.text, line.from);
    if (image) {
      const isActiveImage = !!imageSourceEditRange && imageSourceEditRange.to >= image.from && imageSourceEditRange.from <= image.to;
      if (!isActiveImage) {
        ranges.push(imageAtom.range(image.from, image.to));
      }
    }
  }
  return Decoration.set(ranges, true);
}

const markdownImageAtomicRangeField = StateField.define<DecorationSet>({
  create: buildMarkdownImageAtomicRanges,
  update(value, transaction) {
    if (transaction.docChanged || transaction.effects.some((effect) => effect.is(editImageSourceEffect))) {
      return buildMarkdownImageAtomicRanges(transaction.state);
    }
    return value;
  },
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

function markdownWysiwygDecorations(
  isPointerSelectionActive?: () => boolean,
  pointerSelectionOverride?: () => { from: number; to: number } | null,
  isMarkdownSyntaxRevealed?: () => boolean,
): Extension {
  const decorationField = StateField.define<DecorationSet>({
    create: (state) => buildMarkdownDecorations(state, { includeInline: false }),
    update(value, transaction) {
      if (transaction.docChanged) {
        const dirtyRanges = layoutDirtyRangesForTransaction(transaction);
        if (dirtyRanges.length === 0) return value.map(transaction.changes);

        const additions = buildMarkdownDecorations(transaction.state, {
          includeInline: false,
          ranges: dirtyRanges,
        });
        const additionRanges: Range<Decoration>[] = [];
        const cursor = additions.iter();
        while (cursor.value) {
          additionRanges.push(cursor.value.range(cursor.from, cursor.to));
          cursor.next();
        }

        return value.map(transaction.changes).update({
          filter: (from, to) => !dirtyRanges.some((range) => rangesIntersect(range, { from, to })),
          add: additionRanges,
          sort: true,
        });
      }

      if (
        transaction.effects.some((effect) => effect.is(revealMarkdownSyntaxEffect)) ||
        (transaction.selection && !isPointerSelectionActive?.())
      ) {
        return buildMarkdownDecorations(transaction.state, {
          includeInline: false,
          suppressActiveInline: isPointerSelectionActive?.(),
          allowDefaultCursor: isMarkdownSyntaxRevealed?.(),
        });
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const inlineDecorations = EditorView.decorations.of((view) =>
    buildMarkdownDecorations(view.state, {
      includeLayout: false,
      ranges: view.visibleRanges,
      selectionOverride: pointerSelectionOverride?.() ?? undefined,
      allowDefaultCursor: isMarkdownSyntaxRevealed?.(),
    })
  );

  return [decorationField, inlineDecorations, markdownImageAtomicRangeField];
}

function revealMarkdownSyntax(view: EditorView) {
  view.dispatch({ effects: revealMarkdownSyntaxEffect.of(null) });
}

function CitationMenu({
  state,
  onSelect,
  onHover,
  onClose,
}: {
  state: CitationMenuState;
  onSelect: (option: CitationOption) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        onHover(Math.min(state.activeIndex + 1, state.options.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        onHover(Math.max(state.activeIndex - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const option = state.options[state.activeIndex];
        if (option) onSelect(option);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, onHover, onSelect, state]);

  if (state.options.length === 0) return null;

  return (
    <div
      className="cm-md-citation-menu"
      role="listbox"
      aria-label="Citation suggestions"
      aria-activedescendant={state.options[state.activeIndex] ? `citation-option-${state.options[state.activeIndex].key}` : undefined}
      style={{ left: state.x, top: state.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {state.options.map((option, index) => (
        <button
          key={option.key}
          id={`citation-option-${option.key}`}
          type="button"
          role="option"
          aria-selected={index === state.activeIndex}
          className={`cm-md-citation-menu-item${index === state.activeIndex ? " is-active" : ""}`}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(option)}
        >
          <span className="cm-md-citation-menu-label">{option.label}</span>
          <span className="cm-md-citation-menu-key">@{option.key}</span>
          <span className="cm-md-citation-menu-meta">{option.meta}</span>
        </button>
      ))}
    </div>
  );
}

export function MarkdownWysiwygEditor({ onSave, onSnapshot, onPreviewTrigger, externalContent }: MarkdownWysiwygEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoSaveRef = useRef<{ path: string; value: string } | null>(null);
  const pendingPreviewRef = useRef<{ path: string; value: string } | null>(null);
  const pointerScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const pointerScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerSelectionActiveRef = useRef(false);
  const pointerSelectionStartRef = useRef<{ from: number; to: number } | null>(null);
  const markdownSyntaxRevealedRef = useRef(false);
  const themeCompartment = useRef(new Compartment());
  const lastExternalSeq = useRef<number | undefined>(undefined);
  const onSaveRef = useRef(onSave);
  const onSnapshotRef = useRef(onSnapshot);
  const onPreviewRef = useRef(onPreviewTrigger);
  const pathRef = useRef<string | null>(null);
  const setLastEditTime = useEditorStore((s) => s.setLastEditTime);
  const editorFontSize = useEditorStore((s) => s.editorFontSize);
  const editorWidth = useEditorStore((s) => s.editorWidth);
  const editorMdFont = useEditorStore((s) => s.editorMdFont);
  const appTheme = useEditorStore((s) => s.theme);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(() => {
    const tab = useEditorStore.getState().activeTab();
    return tab && isMarkdownPath(tab.path) ? { path: tab.path, content: tab.content } : null;
  });
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; filter: string } | null>(null);
  const slashStartRef = useRef<number | null>(null);
  const [citationMenu, setCitationMenu] = useState<CitationMenuState | null>(null);

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => { onPreviewRef.current = onPreviewTrigger; }, [onPreviewTrigger]);

  useEffect(() => {
    const tab = useEditorStore.getState().activeTab();
    setEditorFile(tab && isMarkdownPath(tab.path) ? { path: tab.path, content: tab.content } : null);
    pathRef.current = tab?.path ?? null;
    setSlashMenu(null);
    slashStartRef.current = null;
    setCitationMenu(null);
    useEditorStore.getState().setSelectedText(null);
  }, [activeTabPath]);

  const flushPendingPersistence = useCallback(() => {
    if (previewUpdateTimer.current) {
      clearTimeout(previewUpdateTimer.current);
      previewUpdateTimer.current = null;
    }
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    const pendingPreview = pendingPreviewRef.current;
    pendingPreviewRef.current = null;
    if (pendingPreview) {
      onPreviewRef.current?.(pendingPreview.path, pendingPreview.value);
    }

    const pendingSave = pendingAutoSaveRef.current;
    pendingAutoSaveRef.current = null;
    if (pendingSave) {
      onSaveRef.current?.(pendingSave.path, pendingSave.value, false);
    }
  }, []);

  const handleChange = useCallback((view: EditorView) => {
    const path = pathRef.current;
    if (!path) return;

    const value = view.state.doc.toString();
    updateTabContent(path, value);
    setLastEditTime(Date.now());

    if (previewUpdateTimer.current) clearTimeout(previewUpdateTimer.current);
    pendingPreviewRef.current = { path, value };
    previewUpdateTimer.current = setTimeout(() => {
      const pending = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      previewUpdateTimer.current = null;
      if (pending) onPreviewRef.current?.(pending.path, pending.value);
    }, previewUpdateDebounceMs);

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    pendingAutoSaveRef.current = { path, value };
    autoSaveTimer.current = setTimeout(() => {
      const pending = pendingAutoSaveRef.current;
      pendingAutoSaveRef.current = null;
      autoSaveTimer.current = null;
      if (pending) onSaveRef.current?.(pending.path, pending.value, false);
    }, 1500);
  }, [setLastEditTime, updateTabContent]);

  const updateCitationMenu = useCallback((view: EditorView) => {
    const selection = view.state.selection.main;
    if (!selection.empty) {
      setCitationMenu(null);
      return;
    }

    const cursor = selection.head;
    const line = view.state.doc.lineAt(cursor);
    const before = view.state.sliceDoc(Math.max(line.from, cursor - 96), cursor);
    const match = before.match(/\[@([\w.:/-]*)$/);
    if (!match) {
      setCitationMenu(null);
      return;
    }

    const options = citationOptions(match[1], useEditorStore.getState().references);
    if (options.length === 0) {
      setCitationMenu(null);
      return;
    }

    const coords = view.coordsAtPos(cursor);
    if (!coords) return;

    setCitationMenu((prev) => ({
      x: coords.left,
      y: coords.bottom + 6,
      from: cursor - match[0].length,
      to: cursor,
      options,
      activeIndex: Math.min(prev?.activeIndex ?? 0, options.length - 1),
    }));
  }, []);

  const centerCursorIfNeeded = useCallback((view: EditorView) => {
    if (!useEditorStore.getState().typewriterMode) return;
    const cursor = view.state.selection.main.head;
    requestAnimationFrame(() => {
      const coords = view.coordsAtPos(cursor);
      if (!coords) return;
      const scroller = view.scrollDOM;
      const scrollerRect = scroller.getBoundingClientRect();
      const targetTop = scroller.scrollTop + (coords.top - scrollerRect.top) - scrollerRect.height / 2;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  }, []);

  const preservePointerScroll = useCallback((view: EditorView) => {
    const snapshot = pointerScrollSnapshotRef.current;
    if (!snapshot || useEditorStore.getState().typewriterMode) return;
    restoreScrollPosition(view, snapshot);
  }, []);

  const releasePointerScrollSnapshot = useCallback(() => {
    pointerSelectionActiveRef.current = false;
    if (pointerScrollTimerRef.current) clearTimeout(pointerScrollTimerRef.current);
    pointerScrollTimerRef.current = setTimeout(() => {
      pointerScrollSnapshotRef.current = null;
      pointerScrollTimerRef.current = null;
    }, 80);
  }, []);

  const insertImageMarkdown = useCallback((view: EditorView, srcs: string[], at?: number) => {
    if (srcs.length === 0) return;
    const selection = view.state.selection.main;
    const insertAt = at ?? selection.from;
    const snippets = srcs.map((src) => `![${src.split("/").pop() ?? "image"}](${src})`).join("\n");
    view.dispatch({
      changes: { from: insertAt, to: at === undefined ? selection.to : insertAt, insert: snippets },
      selection: EditorSelection.cursor(insertAt + snippets.length),
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const extensions = useMemo<Extension[]>(() => [
    highlightSpecialChars(),
    EditorState.transactionFilter.of((tr) => {
      let hasNBSP = false;
      const changes: { from: number; to?: number; insert?: string }[] = [];
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const text = inserted.toString();
        if (text.includes("\u00a0")) {
          hasNBSP = true;
          changes.push({ from: fromA, to: toA, insert: text.replace(/\u00a0/g, " ") });
        } else {
          changes.push({ from: fromA, to: toA, insert: text });
        }
      });
      if (!hasNBSP) return tr;
      return {
        changes,
        selection: tr.selection,
        effects: tr.effects,
        annotations: (tr as unknown as Record<string, unknown>).annotations as TransactionSpec["annotations"],
        scrollIntoView: tr.scrollIntoView,
      } satisfies TransactionSpec;
    }),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    bracketMatching(),
    markdown(),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.meta, color: "#404740" },
      { tag: tags.link, textDecoration: "none" },
      { tag: tags.url, color: "inherit" },
      { tag: tags.heading, fontWeight: "bold" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.strong, fontWeight: "bold" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
      { tag: tags.keyword, color: "#708" },
      { tag: [tags.atom, tags.bool, tags.contentSeparator, tags.labelName], color: "#219" },
      { tag: [tags.literal, tags.inserted], color: "#164" },
      { tag: [tags.string, tags.deleted], color: "#a11" },
      { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "#e40" },
      { tag: tags.definition(tags.variableName), color: "#00f" },
      { tag: tags.local(tags.variableName), color: "#30a" },
      { tag: [tags.typeName, tags.namespace], color: "#085" },
      { tag: tags.className, color: "#167" },
      { tag: [tags.special(tags.variableName), tags.macroName], color: "#256" },
      { tag: tags.definition(tags.propertyName), color: "#00c" },
      { tag: tags.comment, color: "#940" },
      { tag: tags.invalid, color: "#f00" },
    ])),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    tableSourceEditRangeField,
    imageSourceEditRangeField,
    htmlBlockEditRangeField,
    markdownWysiwygDecorations(
      () => pointerSelectionActiveRef.current,
      () => pointerSelectionStartRef.current,
      () => markdownSyntaxRevealedRef.current,
    ),
    EditorView.lineWrapping,
    keymap.of([
      {
        key: "Mod-s",
        run(view) {
          const path = pathRef.current;
          if (!path) return false;
          const value = view.state.doc.toString();
          onSaveRef.current?.(path, value, true);
          onSnapshotRef.current?.(path);
          return true;
        },
      },
      {
        key: "Backspace",
        run: (view) => deleteImageAtCursor(view, "backward"),
      },
      {
        key: "Delete",
        run: (view) => deleteImageAtCursor(view, "forward"),
      },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handleChange(update.view);

      if (update.selectionSet || update.docChanged) {
        if (update.selectionSet && !update.docChanged && pointerSelectionActiveRef.current && !update.state.selection.main.empty) {
          preservePointerScroll(update.view);
        }

        const selection = update.state.selection.main;
        if (selection.empty) {
          useEditorStore.getState().setSelectedText(null);
        } else {
          useEditorStore.getState().setSelectedText(update.state.sliceDoc(selection.from, selection.to) || null);
        }

        const anchor = slashStartRef.current;
        if (anchor !== null) {
          const cursor = selection.head;
          const filter = update.state.sliceDoc(anchor + 1, cursor);
          if (cursor <= anchor || /\s/.test(filter)) {
            setSlashMenu(null);
            slashStartRef.current = null;
          } else {
            setSlashMenu((prev) => (prev ? { ...prev, filter } : null));
          }
        }

        updateCitationMenu(update.view);
        centerCursorIfNeeded(update.view);
      }
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0) return false;
        pointerSelectionActiveRef.current = true;
        const selection = view.state.selection.main;
        pointerSelectionStartRef.current = { from: selection.from, to: selection.to };
        let pointerPos: number | null = null;
        try {
          pointerPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        } catch {
          event.preventDefault();
        }
        pointerScrollSnapshotRef.current = captureScrollSnapshot(
          view,
          pointerPos,
        );
        if (pointerScrollTimerRef.current) clearTimeout(pointerScrollTimerRef.current);
        pointerScrollTimerRef.current = setTimeout(() => {
          pointerSelectionActiveRef.current = false;
          pointerScrollSnapshotRef.current = null;
          pointerScrollTimerRef.current = null;
        }, 3000);
        return pointerPos === null;
      },
      mouseup(_event, view) {
        releasePointerScrollSnapshot();
        if (view.state.selection.main.empty) {
          pointerSelectionStartRef.current = null;
        }
        markdownSyntaxRevealedRef.current = true;
        revealMarkdownSyntax(view);
        return false;
      },
      click(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const link = linkAtPosition(view, pos);
        if (!link) return false;
        event.preventDefault();
        selectRangePreservingScroll(view, link.from, link.to);
        openUrl(link.href).catch((err: unknown) => logger.error("open link failed", err));
        return true;
      },
      dragover(event) {
        if (event.dataTransfer?.types.includes("Files") || getActiveDragSource()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      drop(event, view) {
        const workspacePath = useEditorStore.getState().workspacePath;
        if (!workspacePath) return false;

        let dropPos = view.state.selection.main.from;
        try {
          dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? dropPos;
        } catch {
          dropPos = view.state.selection.main.from;
        }
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          copyImageFilesToAssets(imageFiles, workspacePath)
            .then((names) => {
              const paths = names.map((name) => markdownImagePathForFile(`${workspacePath}/assets/${name}`));
              insertImageMarkdown(view, paths, dropPos);
            })
            .catch((err: unknown) => logger.error("image drop error", err));
          return true;
        }

        const dragPath = getActiveDragSource();
        if (dragPath && /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(dragPath)) {
          event.preventDefault();
          event.stopPropagation();
          insertImageMarkdown(view, [markdownImagePathForFile(dragPath)], dropPos);
          return true;
        }

        return false;
      },
      keyup(event, view) {
        revealMarkdownSyntax(view);
        if (event.key !== "/") return false;
        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);
        const beforeSlash = view.state.sliceDoc(line.from, cursor - 1);
        if (beforeSlash.trim() !== "") return false;

        slashStartRef.current = cursor - 1;
        const coords = view.coordsAtPos(cursor);
        if (coords) {
          setSlashMenu({ x: coords.left, y: coords.bottom + 4, filter: "" });
        }
        return false;
      },
    }),
    themeCompartment.current.of(EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "16px",
        fontFamily: "system-ui, sans-serif",
      },
    })),
  ], [centerCursorIfNeeded, handleChange, insertImageMarkdown, preservePointerScroll, releasePointerScrollSnapshot, updateCitationMenu]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editorFile) return;

    const state = EditorState.create({
      doc: editorFile.content,
      extensions,
    });
    const view = new EditorView({ state, parent: container });
    const fm = frontmatterAtTop(view.state);
    if (fm && view.state.selection.main.from <= fm.to) {
      view.dispatch({ selection: { anchor: fm.to + 1 } });
    }
    viewRef.current = view;
    pathRef.current = editorFile.path;
    const scroller = view.scrollDOM;
    const revealScrollbar = () => {
      scroller.classList.add("is-scrolling");
      if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
      scrollbarTimerRef.current = setTimeout(() => {
        scroller.classList.remove("is-scrolling");
        scrollbarTimerRef.current = null;
      }, 700);
    };
    scroller.addEventListener("scroll", revealScrollbar, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", revealScrollbar);
      if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [editorFile?.path, extensions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(EditorView.theme({
        "&": {
          height: "100%",
          fontSize: `${editorFontSize}px`,
          fontFamily: editorMdFont,
        },
      })),
    });
  }, [editorFontSize, editorMdFont]);

  useEffect(() => {
    if (!externalContent || !viewRef.current) return;
    if (lastExternalSeq.current === externalContent.seq) return;
    lastExternalSeq.current = externalContent.seq;
    const view = viewRef.current;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: externalContent.content },
      selection: EditorSelection.cursor(0),
    });
    const path = pathRef.current;
    if (path) updateTabContent(path, externalContent.content);
  }, [externalContent, updateTabContent]);

  // Subscribe to active tab content changes from store (e.g., file watcher).
  // Uses Zustand's subscribe API (no re-renders). When content changes for the
  // same active tab, update the CodeMirror document imperatively.
  useEffect(() => {
    let prevContent: string | undefined;
    let prevPath: string | undefined;
    const unsub = useEditorStore.subscribe((state) => {
      const tab = state.tabs.find((t) => t.path === state.activeTabPath);
      if (!tab) return;
      const { content, path } = tab;
      if (prevContent !== undefined && (content === prevContent || path !== prevPath)) {
        prevContent = content;
        prevPath = path;
        return;
      }
      prevContent = content;
      prevPath = path;
      const view = viewRef.current;
      if (!view) return;
      if (content !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
          selection: EditorSelection.cursor(0),
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const view = viewRef.current;
      if (!view) return;
      const rawText = (event as CustomEvent<string>).detail;
      const text = rawText.startsWith("\n") && !rawText.endsWith("\n") ? `${rawText}\n` : rawText;
      const range = externalInsertRange(view, text);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: EditorSelection.cursor(range.from + text.length),
        scrollIntoView: true,
      });
      view.focus();
    };
    window.addEventListener("editor:insert", handler);
    return () => window.removeEventListener("editor:insert", handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const view = viewRef.current;
      if (!view) return;
      const text = (event as CustomEvent<string>).detail;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(0),
        scrollIntoView: true,
      });
      view.focus();
    };
    window.addEventListener("editor:replace-document", handler);
    return () => window.removeEventListener("editor:replace-document", handler);
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", releasePointerScrollSnapshot);
    window.addEventListener("blur", releasePointerScrollSnapshot);
    return () => {
      window.removeEventListener("mouseup", releasePointerScrollSnapshot);
      window.removeEventListener("blur", releasePointerScrollSnapshot);
    };
  }, [releasePointerScrollSnapshot]);

  useEffect(() => {
    return () => {
      flushPendingPersistence();
      if (pointerScrollTimerRef.current) clearTimeout(pointerScrollTimerRef.current);
      if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
    };
  }, [flushPendingPersistence]);

  const handleSlashSelect = useCallback((command: SlashCommand) => {
    const view = viewRef.current;
    const slashStart = slashStartRef.current;
    if (!view || slashStart === null) return;

    const cursor = view.state.selection.main.head;

    if (command.id === "ai-chat") {
      view.dispatch({
        changes: { from: slashStart, to: cursor, insert: "" },
        selection: EditorSelection.cursor(slashStart),
      });
      const store = useEditorStore.getState();
      const panels = store.activePanels.filter((panel) => panel !== "ai" && panel !== "editor");
      store.setActivePanels(["ai", "editor", ...panels].slice(0, 5));
      window.dispatchEvent(new CustomEvent("ai:focus-input"));
      setSlashMenu(null);
      slashStartRef.current = null;
      return;
    }

    const snippet = command.id === "table" ? tableSnippet(command.snippet) : command.snippet;
    const offset = snippetOffset(snippet, command.cursorOffset ?? snippet.length);
    const selectLength = command.selectLength ?? 0;
    const anchor = slashStart + offset;
    const head = anchor + selectLength;

    view.dispatch({
      changes: { from: slashStart, to: cursor, insert: snippet },
      selection: selectLength > 0
        ? EditorSelection.range(anchor, head)
        : EditorSelection.cursor(anchor),
      scrollIntoView: true,
    });
    setSlashMenu(null);
    slashStartRef.current = null;
    view.focus();
  }, []);

  const handleCitationSelect = useCallback((option: CitationOption) => {
    const view = viewRef.current;
    const menu = citationMenu;
    if (!view || !menu) return;

    const text = `[@${option.key}]`;
    view.dispatch({
      changes: { from: menu.from, to: menu.to, insert: text },
      selection: EditorSelection.cursor(menu.from + text.length),
      scrollIntoView: true,
    });
    setCitationMenu(null);
    view.focus();
  }, [citationMenu]);

  const handleCitationHover = useCallback((index: number) => {
    setCitationMenu((prev) => prev ? {
      ...prev,
      activeIndex: Math.max(0, Math.min(index, prev.options.length - 1)),
    } : prev);
  }, []);

  if (!editorFile) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-message">
          <div className="editor-empty-icon">+</div>
          <p>Open a Markdown file to start writing</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`markdown-wysiwyg markdown-wysiwyg--${appTheme}`}
      style={{
        "--markdown-wysiwyg-width": `${editorWidth}px`,
      } as React.CSSProperties}
    >
      <div className="markdown-wysiwyg-editor" ref={containerRef} />
      {slashMenu && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          filter={slashMenu.filter}
          onSelect={handleSlashSelect}
          onClose={() => {
            setSlashMenu(null);
            slashStartRef.current = null;
            viewRef.current?.focus();
          }}
        />
      )}
      {citationMenu && (
        <CitationMenu
          state={citationMenu}
          onSelect={handleCitationSelect}
          onHover={handleCitationHover}
          onClose={() => {
            setCitationMenu(null);
            viewRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
