import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRoutesStub, useNavigationType } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import Dashboard from "./dashboard";
import Home from "./home";
import { projectKeyPrefix } from "../projects/project-storage";
import { refreshProjects } from "../projects/use-projects";

// jsdom has no modal dialogs, so the floating window's are stood in for.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function renderHome(path = "/", DashboardScreen = Dashboard) {
  const Stub = createRoutesStub([
    { path: "/", Component: Home },
    { path: "/dashboard", Component: DashboardScreen },
  ]);
  render(<Stub initialEntries={[path]} />);
}

// Shows how the dashboard was reached.
function NavigationProbe() {
  return <p>Arrived by {useNavigationType()}</p>;
}

function saveProject() {
  localStorage.setItem(`${projectKeyPrefix}a`, "{}");
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    localStorage.clear();
    refreshProjects();
    document.documentElement.removeAttribute("data-has-projects");
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

  it("lists its keyboard shortcuts", () => {
    renderHome();
    const panel = screen.getByRole("complementary", {
      name: "Keyboard shortcuts",
    });
    expect(
      [...panel.querySelectorAll("li")].map((row) => row.textContent),
    ).toEqual(["TToggle tuning panel", "FToggle fading panel"]);
  });

  it("has no shortcuts panel and no tuning panels in the deployed app", () => {
    vi.stubEnv("DEV", false);
    renderHome();
    expect(
      screen.queryByRole("complementary", { name: "Keyboard shortcuts" }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "f" });
    expect(document.querySelector(".tuning-panel")).toBeNull();
    expect(document.querySelector(".fade-tuning-panel")).toBeNull();
  });

  it("shows a Get Started button that goes to the dashboard", () => {
    renderHome();
    const button = screen.getByRole("link", { name: "Get Started" });
    expect(button.getAttribute("href")).toBe("/dashboard");
  });

  it("opens the Add project form on Get Started, without saving anything", async () => {
    renderHome();
    fireEvent.click(screen.getByRole("link", { name: "Get Started" }));
    const title = await screen.findByRole("textbox", { name: "Title" });
    expect(document.activeElement).toBe(title);
    expect(localStorage.length).toBe(0);
  });

  it("does not count tuning settings as saved projects", () => {
    localStorage.setItem("abodeo-button-tuning", "{}");
    renderHome();
    expect(document.documentElement.hasAttribute("data-has-projects")).toBe(
      false,
    );
  });

  it("moves a returning visitor on to the dashboard after the logo's hold", async () => {
    vi.useFakeTimers();
    saveProject();
    renderHome("/", NavigationProbe);
    expect(document.documentElement.hasAttribute("data-has-projects")).toBe(
      true,
    );
    await act(() => vi.advanceTimersByTimeAsync(1399));
    expect(screen.queryByText(/Arrived by/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    // Replacing the welcome screen in history, so Back leaves the app.
    expect(screen.getByText("Arrived by REPLACE")).toBeTruthy();
  });

  it("shows the welcome screen to a visitor with only default projects", async () => {
    vi.useFakeTimers();
    saveProject();
    localStorage.setItem(
      "abodeo-default-projects",
      JSON.stringify({ hash: "h", ids: ["a"] }),
    );
    renderHome("/", NavigationProbe);
    expect(document.documentElement.hasAttribute("data-has-projects")).toBe(
      false,
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole("link", { name: "Get Started" })).toBeTruthy();
  });

  it("shows the welcome screen at /?welcome even with projects saved", async () => {
    vi.useFakeTimers();
    saveProject();
    renderHome("/?welcome", NavigationProbe);
    expect(document.documentElement.hasAttribute("data-has-projects")).toBe(
      false,
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole("link", { name: "Get Started" })).toBeTruthy();
  });
});
