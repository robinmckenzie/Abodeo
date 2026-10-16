import { describe, expect, it } from "vitest";

import {
  addTasks,
  createTasks,
  deleteTask,
  isTask,
  moveTask,
  readTaskEntries,
  renameTask,
  restoreTask,
  setTaskDone,
  type Task,
} from "./tasks";

const tasks: Task[] = [
  { id: "a", title: "Tiles", isDone: false },
  { id: "b", title: "Grout", isDone: true },
  { id: "c", title: "Seal", isDone: false },
];

const ids = (list: Task[]) => list.map((task) => task.id).join("");

describe("reading task entries", () => {
  it("makes one incomplete task per line, in order, trimmed", () => {
    expect(readTaskEntries("  Tiles \nGrout\r\nSeal")).toEqual([
      { title: "Tiles", isDone: false },
      { title: "Grout", isDone: false },
      { title: "Seal", isDone: false },
    ]);
  });

  it("removes bullet and numbered list markers followed by a space", () => {
    expect(
      readTaskEntries("- One\n* Two\n+ Three\n1. Four\n12) Five").map(
        (entry) => entry.title,
      ),
    ).toEqual(["One", "Two", "Three", "Four", "Five"]);
  });

  it("keeps markers not followed by a space, and other Markdown", () => {
    expect(
      readTaskEntries("-One\n1.5 litres\n**Bold** _it_\n2024 budget").map(
        (entry) => entry.title,
      ),
    ).toEqual(["-One", "1.5 litres", "**Bold** _it_", "2024 budget"]);
  });

  it("reads Markdown checkboxes, with or without a list marker", () => {
    expect(
      readTaskEntries("[ ] A\n[x] B\n[X] C\n- [ ] D\n- [x] E\n2. [X] F"),
    ).toEqual([
      { title: "A", isDone: false },
      { title: "B", isDone: true },
      { title: "C", isDone: true },
      { title: "D", isDone: false },
      { title: "E", isDone: true },
      { title: "F", isDone: true },
    ]);
  });

  it("ignores blank lines and lines with only markers", () => {
    expect(readTaskEntries("\n  \n-\n[ ]\n- [x]\n1.\n* [ ] \nReal")).toEqual([
      { title: "Real", isDone: false },
    ]);
  });

  it("removes only the leading markers", () => {
    expect(readTaskEntries("- [x] Buy - [ ] nails")).toEqual([
      { title: "Buy - [ ] nails", isDone: true },
    ]);
  });
});

describe("changing tasks", () => {
  it("gives created tasks their own ids", () => {
    const created = createTasks([
      { title: "A", isDone: false },
      { title: "B", isDone: true },
    ]);
    expect(created.map(isTask)).toEqual([true, true]);
    expect(created[0].id).not.toBe(created[1].id);
    expect(created[1].isDone).toBe(true);
  });

  it("recognises only complete tasks with a title", () => {
    expect(isTask(tasks[0])).toBe(true);
    expect(isTask({ id: "a", title: " ", isDone: false })).toBe(false);
    expect(isTask({ id: "a", title: "A" })).toBe(false);
    expect(isTask(null)).toBe(false);
  });

  it("adds tasks at the end", () => {
    expect(ids(addTasks(tasks, [{ id: "d", title: "D", isDone: false }]))).toBe(
      "abcd",
    );
  });

  it("marks a task done or not done without moving it", () => {
    const next = setTaskDone(tasks, "a", true);
    expect(next[0]).toEqual({ id: "a", title: "Tiles", isDone: true });
    expect(ids(next)).toBe("abc");
    expect(setTaskDone(next, "a", false)[0].isDone).toBe(false);
  });

  it("renames a task, trimmed, and ignores an empty title", () => {
    expect(renameTask(tasks, "b", "  Grout grey ")[1].title).toBe("Grout grey");
    expect(renameTask(tasks, "b", "   ")).toBe(tasks);
  });

  it("deletes a task and restores it where it was", () => {
    const deleted = deleteTask(tasks, "b");
    expect(ids(deleted)).toBe("ac");
    expect(restoreTask(deleted, tasks[1], 1)).toEqual(tasks);
    expect(ids(restoreTask(deleteTask(deleted, "c"), tasks[1], 5))).toBe("ab");
    expect(restoreTask(tasks, tasks[1], 0)).toBe(tasks);
  });

  it("moves a task to a position, clamped to the ends", () => {
    expect(ids(moveTask(tasks, "a", 2))).toBe("bca");
    expect(ids(moveTask(tasks, "c", 0))).toBe("cab");
    expect(ids(moveTask(tasks, "b", -1))).toBe("bac");
    expect(ids(moveTask(tasks, "b", 9))).toBe("acb");
    expect(moveTask(tasks, "x", 0)).toBe(tasks);
  });
});
