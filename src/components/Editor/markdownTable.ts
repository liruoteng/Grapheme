import { normalizeTableDelimiterEscapes } from "./markdownEscapeUtil";

export type MarkdownTable = {
  from: number;
  to: number;
  header: string[];
  alignments: Array<"left" | "center" | "right" | null>;
  rows: string[][];
};

type MarkdownDocLike = {
  lines: number;
  line(lineNumber: number): { from: number; to: number; text: string };
};

export function splitTableRow(text: string) {
  const normalized = normalizeTableDelimiterEscapes(text).trim();
  const body = normalized
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (char === "\\" && next === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function escapeTableCell(cell: string) {
  return cell.replace(/\|/g, "\\|");
}

function formatTableRow(cells: string[]) {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

export function tableSnippet(snippet: string) {
  return snippet.split("\n").map(normalizeTableDelimiterEscapes).join("\n");
}

export function serializeTable(table: Pick<MarkdownTable, "header" | "alignments" | "rows">) {
  const separator = table.alignments.map((align) => {
    if (align === "left") return ":---";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });

  return [
    formatTableRow(table.header),
    formatTableRow(separator),
    ...table.rows.map(formatTableRow),
  ].join("\n");
}

export function insertRowIntoTable(table: MarkdownTable) {
  return insertRowIntoTableAt(table, table.rows.length);
}

export function insertRowIntoTableAt(table: MarkdownTable, rowIndex: number) {
  const nextRows = [...table.rows];
  nextRows.splice(Math.max(0, Math.min(rowIndex, nextRows.length)), 0, table.header.map(() => ""));
  return serializeTable({
    header: table.header,
    alignments: table.alignments,
    rows: nextRows,
  });
}

export function insertColumnIntoTable(table: MarkdownTable) {
  return insertColumnIntoTableAt(table, table.header.length);
}

export function insertColumnIntoTableAt(table: MarkdownTable, colIndex: number) {
  const insertAt = Math.max(0, Math.min(colIndex, table.header.length));
  const nextColumn = `Column ${table.header.length + 1}`;
  const insertInto = <T>(items: T[], value: T) => {
    const next = [...items];
    next.splice(insertAt, 0, value);
    return next;
  };

  return serializeTable({
    header: insertInto(table.header, nextColumn),
    alignments: insertInto(table.alignments, null),
    rows: table.rows.map((row) => insertInto(row, "")),
  });
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return [...items];
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return [...items];

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function moveTableRow(table: MarkdownTable, fromIndex: number, toIndex: number) {
  return serializeTable({
    header: table.header,
    alignments: table.alignments,
    rows: moveItem(table.rows, fromIndex, toIndex),
  });
}

export function moveTableVisualRow(table: MarkdownTable, fromIndex: number, toIndex: number) {
  const rows = moveItem([table.header, ...table.rows], fromIndex, toIndex);
  return serializeTable({
    header: rows[0] ?? table.header,
    alignments: table.alignments,
    rows: rows.slice(1),
  });
}

export function moveTableColumn(table: MarkdownTable, fromIndex: number, toIndex: number) {
  return serializeTable({
    header: moveItem(table.header, fromIndex, toIndex),
    alignments: moveItem(table.alignments, fromIndex, toIndex),
    rows: table.rows.map((row) => moveItem(row, fromIndex, toIndex)),
  });
}

function parseTableAlignment(separator: string) {
  const cells = splitTableRow(separator);
  if (cells.length < 2 || cells.some((cell) => !/^:?-+:?$/.test(cell.replace(/\s+/g, "")))) return null;

  return cells.map((cell) => {
    const compact = cell.replace(/\s+/g, "");
    const left = compact.startsWith(":");
    const right = compact.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function isTableRow(text: string) {
  return normalizeTableDelimiterEscapes(text).includes("|") && splitTableRow(text).length >= 2;
}

export function tableAt(doc: MarkdownDocLike, lineNumber: number): MarkdownTable | null {
  if (lineNumber >= doc.lines) return null;

  const headerLine = doc.line(lineNumber);
  const separatorLine = doc.line(lineNumber + 1);
  if (!isTableRow(headerLine.text)) return null;

  const alignments = parseTableAlignment(separatorLine.text);
  if (!alignments) return null;

  const header = splitTableRow(headerLine.text);
  if (header.length !== alignments.length) return null;

  const rows: string[][] = [];
  let lastLine = separatorLine;
  let nextLineNumber = lineNumber + 2;
  while (nextLineNumber <= doc.lines) {
    const rowLine = doc.line(nextLineNumber);
    if (!isTableRow(rowLine.text)) break;
    rows.push(splitTableRow(rowLine.text));
    lastLine = rowLine;
    nextLineNumber += 1;
  }

  return {
    from: headerLine.from,
    to: lastLine.to,
    header,
    alignments,
    rows,
  };
}
