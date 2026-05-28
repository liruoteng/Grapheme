import { describe, it, expect } from "vitest";
import {
  splitTableRow,
  serializeTable,
  insertRowIntoTable,
  insertColumnIntoTable,
  tableAt,
  tableSnippet,
} from "./markdownTable";

describe("splitTableRow", () => {
  it("splits simple row", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  it("handles row without leading/trailing pipes", () => {
    expect(splitTableRow("a | b | c")).toEqual(["a", "b", "c"]);
  });

  it("handles escaped pipes", () => {
    const result = splitTableRow("| col1 | col\\|pipe | col3 |");
    expect(result).toEqual(["col1", "col|pipe", "col3"]);
  });

  it("escaped pipe with single escape stays escaped", () => {
    const result = splitTableRow("| col\\|withpipe | col2 |");
    expect(result).toEqual(["col|withpipe", "col2"]);
  });

  it("handles single cell", () => {
    const result = splitTableRow("| single |");
    expect(result).toEqual(["single"]);
  });

  it("trims cell whitespace", () => {
    const result = splitTableRow("|  a  |  b  |");
    expect(result).toEqual(["a", "b"]);
  });
});

describe("tableSnippet", () => {
  it("normalizes delimiter escapes across lines", () => {
    const result = tableSnippet("a\\|b\nc\\|d");
    expect(result).toBe("a\\|b\nc\\|d");
  });

  it("handles single line", () => {
    const result = tableSnippet("just one line");
    expect(result).toBe("just one line");
  });
});

describe("serializeTable", () => {
  it("serializes table with correct separators", () => {
    const result = serializeTable({
      header: ["Name", "Age"],
      alignments: ["left", "right"],
      rows: [["Alice", "30"]],
    });
    const lines = result.split("\n");
    expect(lines[0]).toBe("| Name | Age |");
    expect(lines[1]).toBe("| :--- | ---: |");
    expect(lines[2]).toBe("| Alice | 30 |");
  });

  it("serializes center alignment", () => {
    const result = serializeTable({
      header: ["Col"],
      alignments: ["center"],
      rows: [["val"]],
    });
    expect(result).toContain("| :---: |");
  });

  it("escapes pipes in cell content", () => {
    const result = serializeTable({
      header: ["Info"],
      alignments: [null],
      rows: [["Foo | Bar"]],
    });
    expect(result).toContain("| Foo \\| Bar |");
  });
});

describe("insertRowIntoTable", () => {
  it("adds an empty row", () => {
    const result = insertRowIntoTable({
      from: 0,
      to: 50,
      header: ["A", "B"],
      alignments: [null, null],
      rows: [["a1", "b1"]],
    });
    const lines = result.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("|  |  |");
  });
});

describe("insertColumnIntoTable", () => {
  it("adds a new column with generated name", () => {
    const result = insertColumnIntoTable({
      from: 0,
      to: 50,
      header: ["A", "B"],
      alignments: ["left", null],
      rows: [
        ["a1", "b1"],
        ["a2", "b2"],
      ],
    });
    const lines = result.split("\n");
    expect(lines[0]).toContain("Column 3");
    expect(lines[1]).toContain("---");
    expect(lines[2]).toContain("|");
    expect(lines[3]).toContain("|");
  });

  it("adds Column 2 when header has 1 column", () => {
    const result = insertColumnIntoTable({
      from: 0,
      to: 30,
      header: ["Only"],
      alignments: [null],
      rows: [["x"]],
    });
    expect(result).toContain("Column 2");
  });
});

describe("tableAt", () => {
  function makeDoc(lines: string[]): Parameters<typeof tableAt>[0] {
    return {
      lines: lines.length,
      line: (n: number) => {
        if (n >= lines.length) return { from: 0, to: 0, text: "" };
        const text = lines[n];
        const from = lines.slice(0, n).reduce((acc, l) => acc + l.length + 1, 0);
        return { from, to: from + text.length, text };
      },
    };
  }

  it("parses a simple table", () => {
    const table = tableAt(
      makeDoc([
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ]),
      0,
    );
    expect(table).not.toBeNull();
    expect(table!.header).toEqual(["A", "B"]);
    expect(table!.alignments).toEqual([null, null]);
    expect(table!.rows).toEqual([["1", "2"]]);
  });

  it("returns null when lineNumber is out of range", () => {
    const table = tableAt(makeDoc(["| A |"]), 5);
    expect(table).toBeNull();
  });

  it("returns null when row is not a table row", () => {
    const table = tableAt(makeDoc(["plain text", "| --- |", "| 1 |"]), 0);
    expect(table).toBeNull();
  });

  it("returns null when separator is invalid", () => {
    const table = tableAt(makeDoc(["| A |", "not a separator", "| 1 |"]), 0);
    expect(table).toBeNull();
  });

  it("returns null when separator has too few cells", () => {
    const table = tableAt(
      makeDoc(["| A | B |", "| x |", "| 1 | 2 |"]),
      0,
    );
    expect(table).toBeNull();
  });

  it("returns null when separator cells don't match alignment pattern", () => {
    const table = tableAt(
      makeDoc(["| A | B |", "| abc | def |", "| 1 | 2 |"]),
      0,
    );
    expect(table).toBeNull();
  });

  it("returns null when header and alignment lengths differ", () => {
    const table = tableAt(
      makeDoc(["| A | B | C |", "| --- | --- |", "| 1 |"]),
      0,
    );
    expect(table).toBeNull();
  });

  it("parses table with alignment markers", () => {
    const table = tableAt(
      makeDoc([
        "| Left | Center | Right |",
        "| :--- | :---: | ---: |",
        "| a | b | c |",
      ]),
      0,
    );
    expect(table!.alignments).toEqual(["left", "center", "right"]);
  });
});
