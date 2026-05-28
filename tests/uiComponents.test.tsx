import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card";
import { Button, buttonVariants } from "../src/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/ui/tabs";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../src/components/ui/dialog";
import {
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../src/components/ui/select";

describe("ui component wrappers", () => {
  it("renders card primitives with their slot attributes", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("renders button variants", () => {
    render(<Button variant="secondary">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(buttonVariants({ variant: "ghost", size: "icon" })).toContain("size-9");
  });

  it("exports tab primitives", () => {
    expect(Tabs).toBeTypeOf("function");
    expect(TabsList).toBeTypeOf("function");
    expect(TabsTrigger).toBeTypeOf("function");
    expect(TabsContent).toBeTypeOf("function");
  });

  it("renders non-context dialog layout primitives", () => {
    render(
      <div>
        <DialogHeader>Dialog header</DialogHeader>
        <DialogFooter>Dialog footer</DialogFooter>
      </div>,
    );

    expect(screen.getByText("Dialog header")).toBeInTheDocument();
    expect(screen.getByText("Dialog footer")).toBeInTheDocument();
    expect(DialogTitle).toBeTypeOf("function");
    expect(DialogDescription).toBeTypeOf("function");
  });

  it("exports select primitives", () => {
    expect(SelectGroup).toBeTypeOf("function");
    expect(SelectLabel).toBeTypeOf("function");
    expect(SelectSeparator).toBeTypeOf("function");
    expect(SelectTrigger).toBeTypeOf("function");
    expect(SelectValue).toBeTypeOf("function");
  });
});
