import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import Dashboard from "./dashboard";
import Home from "./home";

function renderHome() {
  const Stub = createRoutesStub([
    { path: "/", Component: Home },
    { path: "/dashboard", Component: Dashboard },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows the logo as the main heading", () => {
    renderHome();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("img")).toBe(
      screen.getByRole("img", { name: "Abodeo - Your home, sorted." }),
    );
  });

  it("no longer shows the previous text", () => {
    renderHome();
    expect(screen.queryByText("Your home, sorted.")).toBeNull();
  });

  it("shows a Get Started button that goes to the dashboard", () => {
    renderHome();
    const button = screen.getByRole("link", { name: "Get Started" });
    expect(button.getAttribute("href")).toBe("/dashboard");
  });

  it("opens the dashboard on Get Started, without saving anything", async () => {
    renderHome();
    fireEvent.click(screen.getByRole("link", { name: "Get Started" }));
    expect(await screen.findByText("No projects added yet.")).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });
});
