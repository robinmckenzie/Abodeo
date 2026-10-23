import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addFloatingMessage,
  FloatingMessages,
  furtherMessagesSuppressedMessage,
  maxMessageBoxes,
  messageDuration,
  messageFadeDuration,
  useFloatingMessages,
} from "./floating-messages";

// Messages are shown by a custom event, as the hook's function cannot leave
// the component during render.
function Harness() {
  const { boxes, showMessage } = useFloatingMessages();
  useEffect(() => {
    const onShow = (event: Event) =>
      showMessage((event as CustomEvent<string>).detail);
    window.addEventListener("show-message", onShow);
    return () => window.removeEventListener("show-message", onShow);
  }, [showMessage]);
  return <FloatingMessages boxes={boxes} />;
}

const show = (text: string) =>
  window.dispatchEvent(new CustomEvent("show-message", { detail: text }));

const texts = () =>
  [...document.querySelectorAll(".floating-message")].map(
    (box) => box.textContent,
  );

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("addFloatingMessage", () => {
  it("adds at the bottom, and stops at ten with one box saying so", () => {
    let boxes = addFloatingMessage([], "first", 1);
    boxes = addFloatingMessage(boxes, "second", 2);
    expect(boxes.map(({ text }) => text)).toEqual(["first", "second"]);
    for (let id = 3; id <= maxMessageBoxes; id++) {
      boxes = addFloatingMessage(boxes, `m${id}`, id);
    }
    expect(boxes).toHaveLength(maxMessageBoxes);
    boxes = addFloatingMessage(boxes, "eleventh", 11);
    expect(boxes).toHaveLength(maxMessageBoxes + 1);
    expect(boxes.at(-1)?.text).toBe(furtherMessagesSuppressedMessage);
    expect(boxes.map(({ text }) => text)).not.toContain("eleventh");
    // Once only.
    expect(addFloatingMessage(boxes, "twelfth", 12)).toBe(boxes);
  });
});

describe("FloatingMessages", () => {
  it("stacks messages in order, fades each after its time, then removes it", () => {
    render(<Harness />);
    act(() => show("one"));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => show("two"));
    expect(texts()).toEqual(["one", "two"]);
    expect(
      document.querySelector(".floating-messages")?.getAttribute("role"),
    ).toBe("status");

    act(() => {
      vi.advanceTimersByTime(messageDuration - 2000);
    });
    const [first, second] = document.querySelectorAll(".floating-message");
    expect(first.classList.contains("is-fading")).toBe(true);
    expect(second.classList.contains("is-fading")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(messageFadeDuration);
    });
    expect(texts()).toEqual(["two"]);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(texts()).toEqual([]);
  });

  it("shows only ten boxes and one saying the rest are suppressed, until they fade", () => {
    render(<Harness />);
    act(() => {
      for (let n = 1; n <= 15; n++) show(`message ${n}`);
    });
    expect(texts()).toHaveLength(maxMessageBoxes + 1);
    expect(texts().at(-1)).toBe(furtherMessagesSuppressedMessage);
    expect(texts()).not.toContain("message 11");

    // Fading boxes still count.
    act(() => {
      vi.advanceTimersByTime(messageDuration);
    });
    act(() => show("late"));
    expect(texts()).not.toContain("late");

    act(() => {
      vi.advanceTimersByTime(messageFadeDuration);
    });
    expect(texts()).toEqual([]);
    act(() => show("again"));
    expect(texts()).toEqual(["again"]);
  });

  it("clears its timers when it goes", () => {
    const { unmount } = render(<Harness />);
    act(() => show("one"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
