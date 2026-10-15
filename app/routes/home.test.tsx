import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "./home";

describe("Home", () => {
  afterEach(cleanup);

  it("shows the logo as the main heading", () => {
    render(<Home />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("img")).toBe(
      screen.getByRole("img", { name: "Abodeo - Your home, sorted." }),
    );
  });

  it("no longer shows the previous text", () => {
    render(<Home />);
    expect(screen.queryByText("Your home, sorted.")).toBeNull();
  });
});
