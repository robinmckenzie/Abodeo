import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Dashboard from "./dashboard";

describe("Dashboard", () => {
  afterEach(cleanup);

  it("shows the small logo as the main heading", () => {
    render(<Dashboard />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("img")).toBe(
      screen.getByRole("img", { name: "Abodeo - Your home, sorted." }),
    );
  });

  it("shows that there are no projects yet", () => {
    render(<Dashboard />);
    expect(screen.getByText("No projects added yet.")).toBeTruthy();
  });
});
