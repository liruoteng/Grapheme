import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./dialog";

describe("DialogClose", () => {
  it("renders within Dialog root", () => {
    render(
      <Dialog open>
        <DialogClose>Close</DialogClose>
      </Dialog>,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});

describe("DialogContent", () => {
  it("renders children when dialog is open", () => {
    render(
      <Dialog open>
        <DialogContent>dialog body</DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("dialog body")).toBeInTheDocument();
  });
});

describe("DialogHeader", () => {
  it("renders", () => {
    render(<DialogHeader>header</DialogHeader>);
    expect(screen.getByText("header")).toHaveAttribute(
      "data-slot",
      "dialog-header",
    );
  });
});

describe("DialogFooter", () => {
  it("renders without close button by default", () => {
    render(
      <Dialog open>
        <DialogFooter>footer</DialogFooter>
      </Dialog>,
    );
    expect(screen.getByText("footer")).toBeInTheDocument();
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });

  it("renders with close button when showCloseButton is true", () => {
    render(
      <Dialog open>
        <DialogFooter showCloseButton={true} />
      </Dialog>,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});

describe("DialogTitle", () => {
  it("renders within Dialog root", () => {
    render(
      <Dialog open>
        <DialogTitle>Title</DialogTitle>
      </Dialog>,
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
  });
});

describe("DialogDescription", () => {
  it("renders within Dialog root", () => {
    render(
      <Dialog open>
        <DialogDescription>desc</DialogDescription>
      </Dialog>,
    );
    expect(screen.getByText("desc")).toBeInTheDocument();
  });
});
