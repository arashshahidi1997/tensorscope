// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AnnotationPopover,
  parseTagsInput,
  type AnnotationPopoverValue,
} from "./AnnotationPopover";

const INITIAL: AnnotationPopoverValue = {
  status: "pending",
  notes: "",
  tags: [],
};

afterEach(() => {
  cleanup();
});

describe("parseTagsInput", () => {
  it("splits, trims, drops blanks, dedupes (preserving first-seen order)", () => {
    expect(parseTagsInput("methods, candidate")).toEqual(["methods", "candidate"]);
    expect(parseTagsInput("  a , ,b,a, c ")).toEqual(["a", "b", "c"]);
    expect(parseTagsInput("")).toEqual([]);
    expect(parseTagsInput(",,,")).toEqual([]);
  });
});

describe("AnnotationPopover", () => {
  it("renders initial values into the form", () => {
    render(
      <AnnotationPopover
        initial={{ status: "maybe", notes: "looks like a candidate", tags: ["methods"] }}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const radio = screen.getByLabelText("maybe") as HTMLInputElement;
    expect(radio.checked).toBe(true);
    const notes = screen.getByLabelText("Event notes") as HTMLTextAreaElement;
    expect(notes.value).toBe("looks like a candidate");
    const tags = screen.getByLabelText("Event tags (comma-separated)") as HTMLInputElement;
    expect(tags.value).toBe("methods");
  });

  it("opens with notes textarea focused", () => {
    render(
      <AnnotationPopover initial={INITIAL} onCommit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Event notes"));
  });

  it("Escape with no edits calls onCancel, not onCommit", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <AnnotationPopover initial={INITIAL} onCommit={onCommit} onCancel={onCancel} />,
    );
    const notes = screen.getByLabelText("Event notes");
    fireEvent.keyDown(notes, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape with edits commits the new values", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <AnnotationPopover initial={INITIAL} onCommit={onCommit} onCancel={onCancel} />,
    );
    const notes = screen.getByLabelText("Event notes") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "candidate" } });
    fireEvent.keyDown(notes, { key: "Escape" });
    expect(onCommit).toHaveBeenCalledWith({
      status: "pending",
      notes: "candidate",
      tags: [],
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cmd+Enter commits the full edit (notes + tags)", () => {
    const onCommit = vi.fn();
    render(
      <AnnotationPopover
        initial={{ status: "accepted", notes: "", tags: [] }}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Event notes"), {
      target: { value: "perfect" },
    });
    fireEvent.change(screen.getByLabelText("Event tags (comma-separated)"), {
      target: { value: "methods, hero" },
    });
    fireEvent.keyDown(screen.getByLabelText("Event notes"), {
      key: "Enter",
      metaKey: true,
    });
    expect(onCommit).toHaveBeenCalledWith({
      status: "accepted",
      notes: "perfect",
      tags: ["methods", "hero"],
    });
  });

  it("blur outside without changes calls onCancel (smoke: no stray decisions)", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render(
      <AnnotationPopover initial={INITIAL} onCommit={onCommit} onCancel={onCancel} />,
    );
    fireEvent.blur(screen.getByLabelText("Event notes"), { relatedTarget: outside });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("blur outside after edits commits the new values", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render(
      <AnnotationPopover initial={INITIAL} onCommit={onCommit} onCancel={onCancel} />,
    );
    const notes = screen.getByLabelText("Event notes") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "n" } });
    fireEvent.blur(notes, { relatedTarget: outside });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("blur to a sibling field inside the popover does not commit", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <AnnotationPopover initial={INITIAL} onCommit={onCommit} onCancel={onCancel} />,
    );
    const notes = screen.getByLabelText("Event notes");
    const tags = screen.getByLabelText("Event tags (comma-separated)");
    // Tab-style focus shift inside the popover.
    fireEvent.blur(notes, { relatedTarget: tags });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
