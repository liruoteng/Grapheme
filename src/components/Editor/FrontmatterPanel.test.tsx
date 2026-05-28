import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FrontmatterPanel } from "./FrontmatterPanel";

const baseRender = (overrides: Partial<Parameters<typeof FrontmatterPanel>[0]> = {}) =>
  render(
    <FrontmatterPanel
      raw={overrides.raw ?? ""}
      onChange={overrides.onChange ?? vi.fn()}
    />,
  );

describe("FrontmatterPanel", () => {
  it("returns null when raw is empty", () => {
    const { container } = baseRender({ raw: "" });
    expect(container.innerHTML).toBe("");
  });

  it("returns null when raw has no frontmatter rows", () => {
    const { container } = baseRender({ raw: "# comment only" });
    expect(container.innerHTML).toBe("");
  });

  it("renders collapsed by default with property count", () => {
    baseRender({ raw: "title: My Doc\nauthor: Me" });
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });

  it("expands to show property rows on toggle", () => {
    baseRender({ raw: "title: My Doc\nauthor: Me" });
    fireEvent.click(screen.getByText("Properties"));
    expect(screen.getByDisplayValue("My Doc")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Me")).toBeInTheDocument();
  });

  it("calls onChange when a value is edited and blurred", () => {
    const onChange = vi.fn();
    baseRender({ raw: "title: Old Title", onChange });
    fireEvent.click(screen.getByText("Properties"));
    const input = screen.getByDisplayValue("Old Title");
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("title: New Title");
  });

  it("blur triggers onChange with current value", () => {
    const onChange = vi.fn();
    baseRender({ raw: "key: value", onChange });
    fireEvent.click(screen.getByText("Properties"));
    const input = screen.getByDisplayValue("value") as HTMLInputElement;
    input.value = "newval";
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("key: newval");
  });

  it("Enter key blurs the input", () => {
    const onChange = vi.fn();
    baseRender({ raw: "key: value", onChange });
    fireEvent.click(screen.getByText("Properties"));
    const input = screen.getByDisplayValue("value") as HTMLInputElement;
    input.value = "newval";
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
  });

  it("shows Add button when expanded", () => {
    baseRender({ raw: "title: Doc" });
    fireEvent.click(screen.getByText("Properties"));
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("does not show Add button when collapsed", () => {
    baseRender({ raw: "title: Doc" });
    expect(screen.queryByText("Add")).not.toBeInTheDocument();
  });
});
