import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

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

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  // Stands in for a project's window behind, which closes on Esc. The
  // confirm window is put on the page's body, as the images put it.
  const onKeyBehind = vi.fn();
  const onCancelBehind = vi.fn();
  render(
    <dialog onKeyDown={onKeyBehind} onCancel={onCancelBehind}>
      {createPortal(
        <ConfirmDialog
          question="Remove this image?"
          detail="It cannot be undone."
          confirmLabel="Remove"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
        document.body,
      )}
    </dialog>,
  );
  return { onConfirm, onCancel, onKeyBehind, onCancelBehind };
}

describe("the confirm window", () => {
  it("asks the question, with the detail below it", () => {
    renderDialog();
    expect(
      screen.getByRole("dialog", { name: "Remove this image?" }),
    ).toBeTruthy();
    expect(screen.getByText("It cannot be undone.")).toBeTruthy();
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

  it("keeps Esc, and the cancel it makes, from the window behind it", () => {
    const { onCancel, onKeyBehind, onCancelBehind } = renderDialog();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Escape",
    });
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onKeyBehind).not.toHaveBeenCalled();
    expect(onCancelBehind).not.toHaveBeenCalled();
  });

  it("confirms on its red button, which has a bin", () => {
    const { onConfirm, onCancel } = renderDialog();
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove.className).toBe("button-delete");
    expect(remove.querySelector("svg")).not.toBeNull();
    fireEvent.click(remove);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
