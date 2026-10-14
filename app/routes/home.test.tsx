import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "./home";

describe("Home", () => {
  afterEach(cleanup);

  it("shows the name Abodeo as the main heading", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Abodeo",
    );
  });

  it("shows the welcoming text", () => {
    render(<Home />);
    expect(screen.getByText("Your home, sorted.")).toBeTruthy();
  });
});
