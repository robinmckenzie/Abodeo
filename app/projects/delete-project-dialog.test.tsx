import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DeleteProjectDialog } from "./delete-project-dialog";

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

const tasks = [
  { id: "a", title: "Tiles", isDone: false },
  { id: "b", title: "Grout", isDone: true },
  { id: "c", title: "Seal", isDone: false },
];

function renderDialog(
  props: Partial<Parameters<typeof DeleteProjectDialog>[0]> = {},
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteProjectDialog
      project={{ title: "Bathroom", tasks }}
      imageCount={2}
      mode="bin"
      isBusy={false}
      message={null}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe("the delete window", () => {
  it("names the project, lists what is lost with counts, and says what happens to appointments", () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: "Delete “Bathroom”?" }),
    ).toBeTruthy();
    expect(screen.getByText("3 tasks")).toBeTruthy();
    expect(screen.getByText("2 images")).toBeTruthy();
    expect(screen.getByText("its assignee and due date")).toBeTruthy();
    expect(
      screen.getByText(/appointments stay in Google Calendar/),
    ).toBeTruthy();
  });

  it("lists tasks and images without counts where there are none", () => {
    renderDialog({ project: { title: "Empty", tasks: [] }, imageCount: 0 });
    expect(screen.getByText("its tasks")).toBeTruthy();
    expect(screen.getByText("its images")).toBeTruthy();
  });

  it("says the project can be restored from the Bin for 2 days, when signed in", () => {
    renderDialog();
    expect(
      screen.getByText(
        /restore it from the Bin for 2 days\. After that it may/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("starts with Cancel focused, and Cancel and Esc do not confirm", () => {
    const { onConfirm, onCancel } = renderDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms only on Delete", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("says signed out there is no Bin and the project is removed for good, with no mention of appointments", () => {
    renderDialog({ mode: "browser" });
    expect(screen.getByText(/there is no Bin/)).toBeTruthy();
    expect(screen.queryByText(/restore it/)).toBeNull();
    expect(screen.queryByText(/Google Calendar/)).toBeNull();
  });

  it("says a permanent delete cannot be undone, without mentioning the Bin", () => {
    renderDialog({ mode: "permanent" });
    expect(
      screen.getByRole("heading", { name: "Delete “Bathroom” permanently?" }),
    ).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    expect(screen.queryByText(/Bin/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete permanently" }),
    ).toBeTruthy();
  });

  it("shows why a try failed, and cannot be used while busy", () => {
    renderDialog({ isBusy: true, message: "Not deleted: try again." });
    expect(screen.getByRole("alert").textContent).toBe(
      "Not deleted: try again.",
    );
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
