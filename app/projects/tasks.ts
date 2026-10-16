// A project's checklist of tasks, and the changes that can be made to it,
// without any storage or user interface, so that each can be tested alone.

export type Task = {
  id: string;
  title: string;
  isDone: boolean;
};

export type TaskEntry = Pick<Task, "title" | "isDone">;

// A bullet ("-", "*" or "+") or a number ("1." or "1)"), then a Markdown
// checkbox ("[ ]", "[x]" or "[X]"), each followed by a space or the line's
// end.
const listMarker = /^(?:[-*+]|\d+[.)])(?:\s+|$)/;
const checkboxMarker = /^\[([ xX])\](?:\s+|$)/;

// One task per line that has a title once its list and checkbox markers are
// removed. A checked checkbox makes a completed task. Other Markdown, such as
// **bold**, is kept as typed.
export function readTaskEntries(text: string): TaskEntry[] {
  const entries: TaskEntry[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    let title = line.trim().replace(listMarker, "");
    let isDone = false;
    const checkbox = checkboxMarker.exec(title);
    if (checkbox) {
      isDone = checkbox[1] !== " ";
      title = title.slice(checkbox[0].length);
    }
    title = title.trim();
    if (title) entries.push({ title, isDone });
  }
  return entries;
}

export function createTasks(entries: TaskEntry[]): Task[] {
  return entries.map((entry) => ({ ...entry, id: crypto.randomUUID() }));
}

export function isTask(value: unknown): value is Task {
  const task = value as Task | null;
  return (
    typeof task?.id === "string" &&
    typeof task.title === "string" &&
    task.title.trim() !== "" &&
    typeof task.isDone === "boolean"
  );
}

export function addTasks(tasks: Task[], added: Task[]) {
  return [...tasks, ...added];
}

export function setTaskDone(tasks: Task[], id: string, isDone: boolean) {
  return tasks.map((task) => (task.id === id ? { ...task, isDone } : task));
}

// Trims the title. An empty one leaves the task as it was.
export function renameTask(tasks: Task[], id: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return tasks;
  return tasks.map((task) =>
    task.id === id ? { ...task, title: trimmed } : task,
  );
}

export function deleteTask(tasks: Task[], id: string) {
  return tasks.filter((task) => task.id !== id);
}

// Puts a deleted task back where it was, or at the end if the list has since
// become shorter. A task already there is not added twice.
export function restoreTask(tasks: Task[], task: Task, index: number) {
  if (tasks.some(({ id }) => id === task.id)) return tasks;
  const next = [...tasks];
  next.splice(Math.min(index, next.length), 0, task);
  return next;
}

// Moves a task to the given position in the resulting list, clamped to the
// list's ends.
export function moveTask(tasks: Task[], id: string, toIndex: number) {
  const from = tasks.findIndex((task) => task.id === id);
  if (from === -1) return tasks;
  const next = [...tasks];
  const [task] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, task);
  return next;
}
