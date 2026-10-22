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

// Whether the same tasks are now in a different order, given their ids
// before.
export function isReordered(before: string[], tasks: Task[]) {
  return (
    before.length === tasks.length &&
    tasks.some((task, index) => task.id !== before[index]) &&
    tasks.every((task) => before.includes(task.id))
  );
}

// How many tasks there are and, if any, how many are done, such as
// "9 tasks, 1 completed", or nothing if there are no tasks.
export function describeTaskCount(tasks: Task[]) {
  if (tasks.length === 0) return "";
  const count = tasks.length === 1 ? "1 task" : `${tasks.length} tasks`;
  const done = tasks.filter((task) => task.isDone).length;
  return done > 0 ? `${count}, ${done} completed` : count;
}

// The tasks one side changed, going from base to result: added, removed,
// renamed, ticked or unticked, or moved. A task counts as moved when it is
// not among the most tasks that kept their order, so that moving one task
// counts only that task.
function findTouchedTasks(base: Task[], result: Task[]) {
  const before = new Map(base.map((task) => [task.id, task]));
  const after = new Map(result.map((task) => [task.id, task]));
  const touched = new Set<string>();
  for (const task of result) {
    const old = before.get(task.id);
    if (!old || old.title !== task.title || old.isDone !== task.isDone) {
      touched.add(task.id);
    }
  }
  for (const task of base) if (!after.has(task.id)) touched.add(task.id);
  const moved = findMovedTasks(
    base.filter((task) => after.has(task.id)).map(({ id }) => id),
    result.filter((task) => before.has(task.id)).map(({ id }) => id),
  );
  moved.forEach((id) => touched.add(id));
  return { touched, isReordered: moved.length > 0 };
}

// The ids, among the same ids in two orders, that are not in the longest run
// kept in the same order.
function findMovedTasks(before: string[], after: string[]) {
  const positions = after.map((id) => before.indexOf(id));
  // Longest increasing subsequence, by patience sorting.
  const tails: number[] = [];
  const tailIndexes: number[] = [];
  const previous: number[] = [];
  positions.forEach((position, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < position) low = middle + 1;
      else high = middle;
    }
    tails[low] = position;
    tailIndexes[low] = index;
    previous[index] = low > 0 ? tailIndexes[low - 1] : -1;
  });
  const kept = new Set<number>();
  let index = tailIndexes[tails.length - 1] ?? -1;
  while (index !== -1) {
    kept.add(index);
    index = previous[index];
  }
  return after.filter((_id, i) => !kept.has(i));
}

// Whether a change to the tasks, from base to mine, can be applied again to
// tasks changed elsewhere, from base to theirs, without undoing either: they
// touch no task in common, and they did not both change the order.
export function canMergeTaskChanges(
  base: Task[],
  mine: Task[],
  theirs: Task[],
) {
  const my = findTouchedTasks(base, mine);
  const other = findTouchedTasks(base, theirs);
  if (my.isReordered && other.isReordered) return false;
  return ![...my.touched].some((id) => other.touched.has(id));
}
