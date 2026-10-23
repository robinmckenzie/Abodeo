import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staleDragDelay, useFileDrag } from "./use-file-drag";

let refusal: string | null = null;
let lastFileTypes: string[] = [];
const onRefusal = vi.fn();
const onDrop = vi.fn();

function Harness() {
  const { isDragging, isRefused } = useFileDrag({
    getRefusal: (fileTypes) => {
      lastFileTypes = fileTypes;
      return refusal;
    },
    onRefusal,
    onDrop,
  });
  return <span data-dragging={isDragging} data-refused={isRefused} />;
}

const isDragging = () =>
  document.querySelector("span")?.getAttribute("data-dragging") === "true";
const isRefusedNow = () =>
  document.querySelector("span")?.getAttribute("data-refused") === "true";

function fire(
  type: string,
  types: string[] = ["Files"],
  files: File[] = [],
  itemTypes: string[] = [],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const items = itemTypes.map((itemType) => ({ kind: "file", type: itemType }));
  const dataTransfer = { types, files, items, dropEffect: "" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, dataTransfer };
}

beforeEach(() => {
  vi.useFakeTimers();
  refusal = null;
  onRefusal.mockClear();
  onDrop.mockClear();
  render(<Harness />);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFileDrag", () => {
  it("counts nested enters and leaves, ending when the drag leaves the page", () => {
    fire("dragenter");
    expect(isDragging()).toBe(true);
    fire("dragenter");
    fire("dragleave");
    expect(isDragging()).toBe(true);
    fire("dragleave");
    expect(isDragging()).toBe(false);
  });

  it("ends on a drop, a drag end, and when nothing more arrives", () => {
    fire("dragenter");
    fire("drop", ["Files"], [new File(["x"], "a.png")]);
    expect(isDragging()).toBe(false);
    expect(onDrop).toHaveBeenCalledTimes(1);

    fire("dragenter");
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(isDragging()).toBe(false);

    fire("dragenter");
    fire("dragover");
    act(() => {
      vi.advanceTimersByTime(staleDragDelay - 100);
    });
    fire("dragover");
    act(() => {
      vi.advanceTimersByTime(staleDragDelay - 100);
    });
    expect(isDragging()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(isDragging()).toBe(false);
  });

  it("says why a drop would be refused once for a drag, with a not-allowed cursor", () => {
    refusal = "Open a project to add an image to it.";
    fire("dragenter");
    const { dataTransfer, event } = fire("dragover");
    fire("dragover");
    fire("dragenter");
    expect(onRefusal).toHaveBeenCalledTimes(1);
    expect(onRefusal).toHaveBeenCalledWith(refusal);
    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("none");

    // A drop that still arrives adds nothing and says nothing more.
    fire("drop", ["Files"], [new File(["x"], "a.png")]);
    expect(onRefusal).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();

    // The next drag says it again.
    fire("dragenter");
    expect(onRefusal).toHaveBeenCalledTimes(2);
  });

  it("gives the file types known while dragging, and those of the files on a drop", () => {
    fire("dragenter", ["Files"], [], ["text/plain", "image/png"]);
    expect(lastFileTypes).toEqual(["text/plain", "image/png"]);
    fire("drop", ["Files"], [new File(["x"], "a.png", { type: "image/png" })]);
    expect(lastFileTypes).toEqual(["image/png"]);
  });

  it("copies where a drop would be accepted, and says nothing", () => {
    fire("dragenter");
    const { dataTransfer } = fire("dragover");
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("follows a change in whether a drop would be accepted during a drag", () => {
    refusal = "Save the project first.";
    fire("dragenter");
    expect(isRefusedNow()).toBe(true);
    refusal = null;
    const { dataTransfer } = fire("dragover");
    expect(isRefusedNow()).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
    refusal = "Sign in to add images";
    fire("dragover");
    expect(isRefusedNow()).toBe(true);
  });

  it("says why a drop is refused when it arrives with no drag before it", () => {
    refusal = "Sign in to add images";
    fire("drop", ["Files"], [new File(["x"], "a.png")]);
    expect(onRefusal).toHaveBeenCalledWith("Sign in to add images");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("leaves dragging text alone", () => {
    const { event } = fire("dragenter", ["text/plain"]);
    fire("dragover", ["text/plain"]);
    const drop = fire("drop", ["text/plain"]);
    expect(isDragging()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(drop.event.defaultPrevented).toBe(false);
    expect(onRefusal).not.toHaveBeenCalled();
  });
});
