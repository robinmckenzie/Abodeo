import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultSizes, parseSizes, sizeTuningScript } from "./size-sliders";
import { TuningPanel } from "./tuning-panel";

function pressT() {
  fireEvent.keyDown(window, { key: "t" });
}

function readStyle() {
  return document.getElementById("size-tuning-css")?.textContent ?? "";
}

describe("SizeSliders", () => {
  afterEach(() => {
    // The T panel remembers whether it is shown, so leave it hidden with the
    // default sizes.
    if (screen.queryByRole("slider", { name: "Logo size" })) {
      fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
      pressT();
    }
    cleanup();
    localStorage.clear();
    document.getElementById("size-tuning-css")?.remove();
  });

  it("shows the logo's and button's sliders with the T panel", () => {
    render(<TuningPanel />);
    expect(screen.queryByRole("slider", { name: "Logo size" })).toBeNull();
    pressT();
    expect(screen.getByRole("slider", { name: "Logo size" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Button size" })).toBeTruthy();
  });

  it("resizes at once and keeps the sizes in local storage", () => {
    render(<TuningPanel />);
    pressT();
    fireEvent.change(screen.getByRole("slider", { name: "Logo size" }), {
      target: { value: "1.2" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Button size" }), {
      target: { value: "0.8" },
    });
    expect(readStyle()).toContain("--logo-size: 1.2");
    expect(readStyle()).toContain("--button-size: 0.8");
    expect(parseSizes(localStorage.getItem("abodeo-size-tuning"))).toEqual({
      logo: 1.2,
      button: 0.8,
    });
  });

  it("resets both sizes and nothing else", () => {
    render(<TuningPanel />);
    pressT();
    const [hoverSize] = screen.getAllByRole("slider", { name: /Size/ });
    fireEvent.change(hoverSize, { target: { value: "1.1" } });
    fireEvent.change(screen.getByRole("slider", { name: "Logo size" }), {
      target: { value: "1.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(localStorage.getItem("abodeo-size-tuning")).toBeNull();
    expect(readStyle()).toContain(`--logo-size: ${defaultSizes.logo};`);
    expect(localStorage.getItem("abodeo-button-tuning")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
  });

  it("shows the sizes in use after T hides and shows the sliders, without local storage", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage is blocked");
      });
    render(<TuningPanel />);
    pressT();
    fireEvent.change(screen.getByRole("slider", { name: "Logo size" }), {
      target: { value: "1.2" },
    });
    pressT();
    pressT();
    expect(
      (screen.getByRole("slider", { name: "Logo size" }) as HTMLInputElement)
        .value,
    ).toBe("1.2");
    expect(readStyle()).toContain("--logo-size: 1.2");
    setItem.mockRestore();
  });

  it("saves nothing when the sliders are only shown", () => {
    render(<TuningPanel />);
    pressT();
    expect(localStorage.length).toBe(0);
  });

  it("uses the default for each saved size that is missing or out of range", () => {
    expect(parseSizes(JSON.stringify({ logo: 1.3, button: 3 }))).toEqual({
      logo: 1.3,
      button: defaultSizes.button,
    });
    expect(parseSizes("not json")).toEqual(defaultSizes);
  });

  it("applies saved sizes from the page's head, checking them first", () => {
    localStorage.setItem(
      "abodeo-size-tuning",
      JSON.stringify({ logo: 0.7, button: 99 }),
    );
    new Function(sizeTuningScript)();
    expect(readStyle()).toContain("--logo-size: 0.7");
    expect(readStyle()).toContain(`--button-size: ${defaultSizes.button};`);
  });

  it("adds nothing to the page's head when no sizes are saved", () => {
    new Function(sizeTuningScript)();
    expect(document.getElementById("size-tuning-css")).toBeNull();
  });

  it("starts from the same sizes as app.css", () => {
    // Tests run from the repository root.
    const css = readFileSync("app/app.css", "utf8");
    const readFallbacks = (name: string) =>
      [...css.matchAll(new RegExp(`var\\(--${name}, ([\\d.]+)\\)`, "g"))].map(
        (match) => Number(match[1]),
      );
    expect(readFallbacks("logo-size")).toEqual([
      defaultSizes.logo,
      defaultSizes.logo,
    ]);
    expect(readFallbacks("button-size")).toEqual([
      defaultSizes.button,
      defaultSizes.button,
    ]);
  });
});
