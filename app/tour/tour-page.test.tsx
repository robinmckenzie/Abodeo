import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  pause,
  pressEnter,
  setFieldValue,
  TourEnded,
  tourPace,
  typeInto,
  waitUntil,
} from "./tour-page";

// A controlled field, as the project form's are, showing its React state.
function Field({ onEnter }: { onEnter?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <input
        aria-label="Title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEnter?.();
        }}
      />
      <p data-testid="state">{value}</p>
    </>
  );
}

const field = () => screen.getByRole<HTMLInputElement>("textbox");
const state = () => screen.getByTestId("state").textContent;

afterEach(() => {
  cleanup();
});

describe("typeInto", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("types one character at a time into a controlled field's state", async () => {
    vi.useFakeTimers();
    render(<Field />);
    const typing = typeInto(field(), "Bake", new AbortController().signal);
    const seen: string[] = [];
    for (let index = 0; index < 4; index++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(tourPace.typing);
      });
      seen.push(state()!);
    }
    await typing;
    expect(seen).toEqual(["B", "Ba", "Bak", "Bake"]);
    expect(field().value).toBe("Bake");
    expect(document.activeElement).toBe(field());
  });

  it("stops when the tour ends", async () => {
    vi.useFakeTimers();
    render(<Field />);
    const running = new AbortController();
    const typing = typeInto(field(), "Bake", running.signal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(tourPace.typing);
    });
    running.abort();
    await expect(typing).rejects.toBeInstanceOf(TourEnded);
    expect(state()).toBe("B");
  });

  it("fills in the rest at once when hurried", async () => {
    vi.useFakeTimers();
    render(<Field />);
    const hurry = new AbortController();
    const typing = typeInto(
      field(),
      "Bake",
      new AbortController().signal,
      hurry.signal,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(tourPace.typing);
    });
    expect(state()).toBe("B");
    await act(async () => {
      hurry.abort();
      await typing;
    });
    expect(state()).toBe("Bake");
  });
});

describe("pause", () => {
  it("ends at once when hurried, and straight away once hurried", async () => {
    const hurry = new AbortController();
    const running = new AbortController().signal;
    const waiting = pause(60_000, running, hurry.signal);
    hurry.abort();
    await expect(waiting).resolves.toBeUndefined();
    await expect(pause(60_000, running, hurry.signal)).resolves.toBeUndefined();
  });
});

describe("setFieldValue and pressEnter", () => {
  it("sets a controlled field's state and presses Enter in it", () => {
    const onEnter = vi.fn();
    render(<Field onEnter={onEnter} />);
    act(() => setFieldValue(field(), "Scones"));
    expect(state()).toBe("Scones");
    pressEnter(field());
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});

describe("waitUntil", () => {
  it("gives what it waited for once it is there", async () => {
    let found: string | null = null;
    setTimeout(() => (found = "here"), 120);
    await expect(
      waitUntil(() => found, new AbortController().signal),
    ).resolves.toBe("here");
  });

  it("stops waiting when the tour ends", async () => {
    const running = new AbortController();
    const waiting = waitUntil(() => false, running.signal);
    running.abort();
    await expect(waiting).rejects.toBeInstanceOf(TourEnded);
  });
});
