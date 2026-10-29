import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DeleteProjectDialog } from "../projects/delete-project-dialog";
import { ProjectForm } from "../projects/project-form";
import { newProjectFields } from "../projects/projects";
import { ScreenPanel } from "../screen-panel";
import {
  ArrowIcon,
  BinIcon,
  BinScreenIcon,
  CloseIcon,
  PeopleIcon,
  PlusIcon,
  ProjectsIcon,
} from "./icons";

// jsdom has no modal dialogs, so they are stood in for.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

function findIcon(button: HTMLElement) {
  return button.querySelector("svg")?.getAttribute("data-icon");
}

describe("the shared icons", () => {
  it("draw every icon in the same 20-unit circle", () => {
    const { container } = render(
      <>
        <PlusIcon />
        <BinIcon />
        <CloseIcon />
        <ArrowIcon direction="left" />
      </>,
    );
    const icons = [...container.querySelectorAll("svg")];
    expect(icons.map((icon) => icon.getAttribute("data-icon"))).toEqual([
      "plus",
      "bin",
      "close",
      "arrow",
    ]);
    for (const icon of icons) {
      expect(icon.getAttribute("viewBox")).toBe("0 0 20 20");
      expect(icon.querySelector("circle")?.getAttribute("r")).toBe("8.5");
    }
  });

  it("turn the arrow to face the way asked", () => {
    const { container } = render(<ArrowIcon direction="up" />);
    expect(container.querySelector("path")?.getAttribute("transform")).toBe(
      "rotate(270 10 10)",
    );
  });

  it("show the bin on an opened project's Delete and the X on its Close", () => {
    render(
      <ProjectForm
        values={{ ...newProjectFields, assignee: "unassigned" }}
        people={[]}
        isNew={false}
        message={null}
        getFocusField={() => "title"}
        onChange={vi.fn()}
        onFieldFocus={vi.fn()}
        onFieldBlur={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      findIcon(screen.getByRole("button", { name: "Delete project" })),
    ).toBe("bin");
    expect(findIcon(screen.getByRole("button", { name: "Close" }))).toBe(
      "close",
    );
  });

  it("show a bin before the words of the delete dialog's Delete", () => {
    render(
      <DeleteProjectDialog
        project={{ title: "Bathroom", tasks: [] }}
        imageCount={0}
        appointmentCount={0}
        mode="bin"
        isBusy={false}
        message={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(findIcon(screen.getByRole("button", { name: "Delete" }))).toBe(
      "bin",
    );
  });

  it("draw the screen icons uncircled, with their own names", () => {
    const { container } = render(
      <>
        <ProjectsIcon />
        <PeopleIcon />
        <BinScreenIcon />
      </>,
    );
    const icons = [...container.querySelectorAll("svg")];
    expect(icons.map((icon) => icon.getAttribute("data-icon"))).toEqual([
      "projects",
      "people",
      "bin-screen",
    ]);
    for (const icon of icons) {
      expect(icon.getAttribute("class")).toBe("screen-icon");
      expect(icon.querySelector("circle")).toBeNull();
    }
  });

  it("keep a screen's title name when an icon sits beside it", () => {
    render(
      <ScreenPanel title="People" icon={<PeopleIcon />}>
        content
      </ScreenPanel>,
    );
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
  });
});
