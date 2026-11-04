// A task list's photo controls and the end of a deleted task's Undo (AD #67
// Add Photos To Tasks). Its other behaviour is tested through the dashboard.
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDrafts } from "./task-drafts";
import { TaskList, undoDuration, type TaskPhotos } from "./task-list";
import type { Task } from "./tasks";

const drafts = new TaskDrafts();

const shed: Task = {
  id: "t1",
  title: "Paint shed",
  isDone: false,
  assignee: "unassigned",
};
const fence: Task = {
  id: "t2",
  title: "Mend fence",
  isDone: false,
  assignee: "unassigned",
};

// Holds the tasks as the dashboard would, applying each change at once.
function renderList({
  tasks = [shed, fence],
  photos = null,
  onUndoEnd,
  failSaves = false,
}: {
  tasks?: Task[];
  photos?: TaskPhotos | null;
  onUndoEnd?: (task: Task) => void;
  failSaves?: boolean;
} = {}) {
  let current = tasks;
  const view = (props: { onUndoEnd?: (task: Task) => void }) => (
    <StrictMode>
      <TaskList
        projectId="p1"
        tasks={current}
        people={[]}
        drafts={drafts}
        photos={photos}
        onUndoEnd={props.onUndoEnd}
        onChange={async (change) => {
          if (failSaves) return "Not saved.";
          current = change(current);
          result.rerender(view(props));
          return null;
        }}
      />
    </StrictMode>
  );
  const result = render(view({ onUndoEnd }));
  return {
    ...result,
    withdrawUndoEnd: () => result.rerender(view({})),
  };
}

async function remove(title: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Delete ${title}` }));
  });
}

describe("the end of a deleted task's Undo (AD #67)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is told when Undo's time runs out", async () => {
    const onUndoEnd = vi.fn();
    renderList({ onUndoEnd });
    await remove("Paint shed");
    expect(onUndoEnd).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(undoDuration));
    expect(onUndoEnd).toHaveBeenCalledExactlyOnceWith(shed);
  });

  it("is not told when Undo is used", async () => {
    const onUndoEnd = vi.fn();
    renderList({ onUndoEnd });
    await remove("Paint shed");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Undo deleting Paint shed" }),
      );
    });
    await act(async () => vi.advanceTimersByTime(undoDuration));
    expect(onUndoEnd).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Edit Paint shed" }),
    ).toBeTruthy();
  });

  it("is told when another deletion replaces it", async () => {
    const onUndoEnd = vi.fn();
    renderList({ onUndoEnd });
    await remove("Paint shed");
    await remove("Mend fence");
    expect(onUndoEnd).toHaveBeenCalledExactlyOnceWith(shed);
    await act(async () => vi.advanceTimersByTime(undoDuration));
    expect(onUndoEnd).toHaveBeenLastCalledWith(fence);
    expect(onUndoEnd).toHaveBeenCalledTimes(2);
  });

  it("is told when the list goes while Undo is offered, and not twice", async () => {
    const onUndoEnd = vi.fn();
    const { unmount } = renderList({ onUndoEnd });
    await remove("Paint shed");
    unmount();
    expect(onUndoEnd).toHaveBeenCalledExactlyOnceWith(shed);
  });

  it("is told when it is no longer given, as for the copy shown while the project closes", async () => {
    const onUndoEnd = vi.fn();
    const { withdrawUndoEnd, unmount } = renderList({ onUndoEnd });
    await remove("Paint shed");
    withdrawUndoEnd();
    expect(onUndoEnd).toHaveBeenCalledExactlyOnceWith(shed);
    await act(async () => vi.advanceTimersByTime(undoDuration));
    unmount();
    expect(onUndoEnd).toHaveBeenCalledTimes(1);
  });

  it("is not told when the deletion could not be saved", async () => {
    const onUndoEnd = vi.fn();
    const { unmount } = renderList({ onUndoEnd, failSaves: true });
    await remove("Paint shed");
    await act(async () => vi.advanceTimersByTime(undoDuration));
    unmount();
    expect(onUndoEnd).not.toHaveBeenCalled();
  });

  it("is not told on mount and unmount with nothing deleted", () => {
    const onUndoEnd = vi.fn();
    renderList({ onUndoEnd }).unmount();
    expect(onUndoEnd).not.toHaveBeenCalled();
  });
});

describe("a task's photo controls (AD #67)", () => {
  afterEach(cleanup);

  const makePhotos = (overrides: Partial<TaskPhotos> = {}): TaskPhotos => ({
    summaries: { t1: { count: 3, latestImageId: "i3" } },
    thumbnails: { t1: "blob:i3" },
    isDropTarget: false,
    onAdd: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  });

  it("are not shown without photos, as signed out", () => {
    const { container } = renderList();
    expect(screen.queryByRole("button", { name: /Add photos/ })).toBeNull();
    expect(container.querySelector("[data-photo-task-id]")).toBeNull();
  });

  it("show a task's count and newest thumbnail, which open its photos", () => {
    const photos = makePhotos();
    const { container } = renderList({ photos });
    const button = screen.getByRole("button", {
      name: "3 photos of Paint shed",
    });
    expect(button.querySelector("img")?.getAttribute("src")).toBe("blob:i3");
    expect(
      screen.queryByRole("button", { name: /photos? of Mend fence/ }),
    ).toBeNull();
    fireEvent.click(button);
    expect(photos.onOpen).toHaveBeenCalledWith(shed);
    expect(container.querySelector('[data-photo-task-id="t2"]')).not.toBeNull();
  });

  it("give the files chosen with a task's Add photos to that task", () => {
    const photos = makePhotos();
    renderList({ photos });
    fireEvent.click(
      screen.getByRole("button", { name: "Add photos to Mend fence" }),
    );
    const files = [new File(["x"], "a.png", { type: "image/png" })];
    fireEvent.change(screen.getByLabelText("Photos to add"), {
      target: { files },
    });
    expect(photos.onAdd).toHaveBeenCalledWith(fence, files);
  });

  it("mark the row files are dragged over, while a drop would be accepted", () => {
    const { rerender, container } = render(
      <TaskList
        projectId="p1"
        tasks={[shed, fence]}
        people={[]}
        drafts={drafts}
        photos={makePhotos({ isDropTarget: true })}
        onChange={async () => null}
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-task-id="t2"]')!;
    fireEvent.dragOver(row, { dataTransfer: { types: ["Files"] } });
    expect(row.classList.contains("is-file-drop-target")).toBe(true);
    rerender(
      <TaskList
        projectId="p1"
        tasks={[shed, fence]}
        people={[]}
        drafts={drafts}
        photos={makePhotos({ isDropTarget: false })}
        onChange={async () => null}
      />,
    );
    expect(row.classList.contains("is-file-drop-target")).toBe(false);
  });
});
