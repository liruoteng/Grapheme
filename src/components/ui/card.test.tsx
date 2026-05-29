import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./card";

describe("Card", () => {
  it("renders with default size", () => {
    render(<Card>content</Card>);
    const el = screen.getByText("content");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-slot", "card");
    expect(el).toHaveAttribute("data-size", "default");
  });

  it("renders with sm size", () => {
    render(<Card size="sm">content</Card>);
    expect(screen.getByText("content")).toHaveAttribute("data-size", "sm");
  });

  it("renders with custom className", () => {
    render(<Card className="custom">content</Card>);
    expect(screen.getByText("content")).toHaveClass("custom");
  });
});

describe("CardHeader", () => {
  it("renders", () => {
    render(<CardHeader>header</CardHeader>);
    expect(screen.getByText("header")).toHaveAttribute("data-slot", "card-header");
  });
});

describe("CardTitle", () => {
  it("renders", () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByText("Title")).toHaveAttribute("data-slot", "card-title");
  });
});

describe("CardDescription", () => {
  it("renders", () => {
    render(<CardDescription>desc</CardDescription>);
    expect(screen.getByText("desc")).toHaveAttribute("data-slot", "card-description");
  });
});

describe("CardAction", () => {
  it("renders", () => {
    render(<CardAction>action</CardAction>);
    expect(screen.getByText("action")).toHaveAttribute("data-slot", "card-action");
  });
});

describe("CardContent", () => {
  it("renders", () => {
    render(<CardContent>body</CardContent>);
    expect(screen.getByText("body")).toHaveAttribute("data-slot", "card-content");
  });
});

describe("CardFooter", () => {
  it("renders", () => {
    render(<CardFooter>footer</CardFooter>);
    expect(screen.getByText("footer")).toHaveAttribute("data-slot", "card-footer");
  });
});

describe("Card composition", () => {
  it("renders full card layout", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>My Card</CardTitle>
          <CardDescription>A description</CardDescription>
          <CardAction>Btn</CardAction>
        </CardHeader>
        <CardContent>Body text</CardContent>
        <CardFooter>Footer text</CardFooter>
      </Card>,
    );
    expect(screen.getByText("My Card")).toBeInTheDocument();
    expect(screen.getByText("A description")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText("Footer text")).toBeInTheDocument();
  });
});
