// An opened project's tasks: a checklist below its notes, with a box below
// it for adding tasks, several at once, one per line. Each change is saved
// straight away by the dashboard, which shows it at once and puts it back if
// saving fails.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import {
  addTasks,
  createTasks,
  deleteTask,
  moveTask,
  readTaskEntries,
  renameTask,
  restoreTask,
  setTaskDone,
  type Task,
} from "./tasks";

export type TaskChange = (tasks: Task[]) => Task[];

// How long Undo is offered after a task is deleted. Closing the project also
// ends it.
export const undoDuration = 8000;

// Text typed into a project's box but not yet added, kept until the page
// reloads, so that closing the project does not lose it.
const unsubmittedText = new Map<string, string>();

// Identifies a task being dragged, so that only tasks can be dropped here,
// and a task dropped into a text field does not type its title there.
const dragType = "application/x-abodeo-task";

export function TaskList({
  projectId,
  tasks,
  onChange,
  finishEditRef,
  className,
  style,
}: {
  projectId: string;
  tasks: Task[];
  // Saves a change, giving the reason it failed, or null once saved.
  onChange: (change: TaskChange) => Promise<string | null>;
  // Set while a title is being edited, so that closing the project can save
  // the edit.
  finishEditRef?: React.RefObject<(() => void) | null>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const entryRef = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(() => unsubmittedText.get(projectId) ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  // Mirrors editing, so that an edit finished by Enter is not finished again
  // by the blur that follows.
  const editingRef = useRef(editing);
  const [deleted, setDeleted] = useState<{ task: Task; index: number } | null>(
    null,
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Where a dragged task would go: before the task at this index, or at the
  // end.
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // A control to focus once the list has rendered, such as a task's title
  // after its edit ends.
  const focusAfterRenderRef = useRef<string | null>(null);

  const save = async (change: TaskChange) => {
    const reason = await onChange(change);
    setFailure(reason);
    return reason;
  };

  useEffect(() => {
    if (!focusAfterRenderRef.current) return;
    const selector = focusAfterRenderRef.current;
    focusAfterRenderRef.current = null;
    document.querySelector<HTMLElement>(selector)?.focus();
  });

  // The box grows a line at a time to fit its text, up to a height set in
  // CSS, beyond which it scrolls. In the floating window, the box first
  // renders before the window opens, when it has no size to measure, so it
  // is measured again once shown.
  useLayoutEffect(() => {
    const entry = entryRef.current;
    if (!entry) return;
    const fitText = () => {
      entry.style.height = "auto";
      const borders = entry.offsetHeight - entry.clientHeight;
      entry.style.height = `${entry.scrollHeight + borders}px`;
    };
    if (entry.getClientRects().length > 0) {
      fitText();
      return;
    }
    entry.style.height = "";
    const frame = requestAnimationFrame(fitText);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  const changeText = (value: string) => {
    setText(value);
    if (value) unsubmittedText.set(projectId, value);
    else unsubmittedText.delete(projectId);
  };

  const isAddingRef = useRef(false);
  const addEntries = async () => {
    const entries = readTaskEntries(text);
    if (entries.length === 0 || isAddingRef.current) return;
    isAddingRef.current = true;
    const added = createTasks(entries);
    const reason = await save((current) => addTasks(current, added));
    isAddingRef.current = false;
    if (!reason) changeText("");
  };

  const startEdit = (task: Task) => {
    const edit = { id: task.id, draft: task.title };
    editingRef.current = edit;
    setEditing(edit);
  };

  const changeDraft = (draft: string) => {
    if (!editingRef.current) return;
    const edit = { ...editingRef.current, draft };
    editingRef.current = edit;
    setEditing(edit);
  };

  // Saves the edit unless it is cancelled. An empty title, or one only
  // trimmed, leaves the title as it was.
  const finishEdit = (isSaved: boolean) => {
    const edit = editingRef.current;
    if (!edit) return;
    editingRef.current = null;
    setEditing(null);
    const task = tasks.find((current) => current.id === edit.id);
    const title = edit.draft.trim();
    if (isSaved && task && title && title !== task.title) {
      void save((current) => renameTask(current, edit.id, title));
    }
  };

  useEffect(() => {
    if (!finishEditRef) return;
    finishEditRef.current = editing ? () => finishEdit(true) : null;
    return () => {
      finishEditRef.current = null;
    };
  });

  const removeTask = async (task: Task, index: number) => {
    setDeleted({ task, index });
    focusAfterRenderRef.current = `#${CSS.escape(id)}-undo`;
    const reason = await save((current) => deleteTask(current, task.id));
    // The task is back, so focus returns to its Delete button.
    if (reason) {
      setDeleted(null);
      focusAfterRenderRef.current = buttonSelector(`${task.id}-delete`);
    }
  };

  const undoDelete = () => {
    if (!deleted) return;
    const { task, index } = deleted;
    setDeleted(null);
    focusAfterRenderRef.current = titleSelector(task.id);
    void save((current) => restoreTask(current, task, index));
  };

  // Undo goes after a while. If it had focus, focus moves to the entry box.
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => {
      const hadFocus = document.activeElement === undoRef.current;
      setDeleted(null);
      if (hadFocus) entryRef.current?.focus();
    }, undoDuration);
    return () => clearTimeout(timer);
  }, [deleted]);

  // By one place, relative to where the task is saved now. Focus stays on
  // the button pressed, which reordering could otherwise lose.
  const moveBy = (task: Task, step: -1 | 1) => {
    focusAfterRenderRef.current = buttonSelector(`${task.id}${step}`);
    void save((current) =>
      moveTask(
        current,
        task.id,
        current.findIndex(({ id }) => id === task.id) + step,
      ),
    );
  };

  const endDrag = () => {
    setDraggedId(null);
    setDropIndex(null);
  };

  const dropTask = () => {
    const from = tasks.findIndex(({ id }) => id === draggedId);
    if (draggedId && from !== -1 && dropIndex !== null) {
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (to !== from) void save((current) => moveTask(current, draggedId, to));
    }
    endDrag();
  };

  return (
    <section
      className={className ? `task-section ${className}` : "task-section"}
      style={style}
      aria-labelledby={`${id}-heading`}
    >
      <h3 id={`${id}-heading`} className="task-heading">
        Tasks
      </h3>
      {tasks.length > 0 && (
        <ul
          className="task-list"
          aria-labelledby={`${id}-heading`}
          onDragOver={(event) => {
            if (!draggedId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!draggedId) return;
            event.preventDefault();
            dropTask();
          }}
        >
          {tasks.map((task, index) => {
            const isEditing = editing?.id === task.id;
            const classes = ["task"];
            if (task.isDone) classes.push("is-done");
            if (task.id === draggedId) classes.push("is-dragged");
            if (dropIndex === index) classes.push("drops-before");
            if (dropIndex === tasks.length && index === tasks.length - 1) {
              classes.push("drops-after");
            }
            return (
              <li
                key={task.id}
                className={classes.join(" ")}
                onDragOver={(event) => {
                  if (!draggedId) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  const isLowerHalf = event.clientY > box.top + box.height / 2;
                  setDropIndex(isLowerHalf ? index + 1 : index);
                }}
              >
                <span
                  className="task-drag"
                  draggable
                  aria-hidden="true"
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    finishEdit(true);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(dragType, task.id);
                    const row = event.currentTarget.closest("li");
                    if (row) event.dataTransfer.setDragImage(row, 12, 12);
                    setDraggedId(task.id);
                  }}
                  onDragEnd={endDrag}
                >
                  <svg viewBox="0 0 10 16">
                    <circle cx="3" cy="3" r="1.25" />
                    <circle cx="7" cy="3" r="1.25" />
                    <circle cx="3" cy="8" r="1.25" />
                    <circle cx="7" cy="8" r="1.25" />
                    <circle cx="3" cy="13" r="1.25" />
                    <circle cx="7" cy="13" r="1.25" />
                  </svg>
                </span>
                <input
                  type="checkbox"
                  className="task-done"
                  checked={task.isDone}
                  aria-label={`Mark ${task.title} as done`}
                  onChange={(event) => {
                    const isDone = event.target.checked;
                    void save((current) =>
                      setTaskDone(current, task.id, isDone),
                    );
                  }}
                />
                {isEditing ? (
                  <input
                    className="task-title-input"
                    value={editing.draft}
                    aria-label={`Title of task ${task.title}`}
                    autoComplete="off"
                    autoFocus
                    onFocus={(event) => {
                      const end = event.target.value.length;
                      event.target.setSelectionRange(end, end);
                    }}
                    onChange={(event) => changeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key !== "Enter" && event.key !== "Escape") {
                        return;
                      }
                      // Kept from the form, so that Escape does not close
                      // the project and Enter does not submit it.
                      event.preventDefault();
                      focusAfterRenderRef.current = titleSelector(task.id);
                      finishEdit(event.key === "Enter");
                    }}
                    onBlur={() => finishEdit(true)}
                  />
                ) : (
                  <button
                    type="button"
                    className="task-title"
                    data-task-title={task.id}
                    aria-label={`Edit ${task.title}`}
                    onClick={() => startEdit(task)}
                  >
                    {task.title}
                  </button>
                )}
                <span className="task-controls">
                  <TaskButton
                    label={`Move ${task.title} up`}
                    focusKey={`${task.id}-1`}
                    isDisabled={index === 0}
                    onClick={() => moveBy(task, -1)}
                    path="M8 13V3M4 7l4-4 4 4"
                  />
                  <TaskButton
                    label={`Move ${task.title} down`}
                    focusKey={`${task.id}1`}
                    isDisabled={index === tasks.length - 1}
                    onClick={() => moveBy(task, 1)}
                    path="M8 3v10M4 9l4 4 4-4"
                  />
                  <TaskButton
                    label={`Delete ${task.title}`}
                    focusKey={`${task.id}-delete`}
                    onClick={() => removeTask(task, index)}
                    path="M4 4l8 8M12 4l-8 8"
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="task-undo" role="status">
        {deleted && (
          <>
            <span>Deleted {deleted.task.title}.</span>
            <button
              ref={undoRef}
              id={`${id}-undo`}
              type="button"
              aria-label={`Undo deleting ${deleted.task.title}`}
              onClick={undoDelete}
            >
              Undo
            </button>
          </>
        )}
      </p>
      <textarea
        ref={entryRef}
        className="task-entry"
        rows={1}
        value={text}
        placeholder="Add tasks, one per line"
        aria-label="Add tasks, one per line"
        aria-describedby={failure ? `${id}-failure` : undefined}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          void addEntries();
        }}
      />
      <p id={`${id}-failure`} className="task-failure" role="alert">
        {failure}
      </p>
    </section>
  );
}

function buttonSelector(focusKey: string) {
  return `[data-task-button="${CSS.escape(focusKey)}"]`;
}

function titleSelector(taskId: string) {
  return `[data-task-title="${CSS.escape(taskId)}"]`;
}

// Disabled at the list's ends with aria-disabled rather than disabled, so
// that a button which has just moved its task there keeps focus.
function TaskButton({
  label,
  focusKey,
  isDisabled = false,
  onClick,
  path,
}: {
  label: string;
  // Finds the button again after the list changes, to give it focus.
  focusKey: string;
  isDisabled?: boolean;
  onClick: () => void;
  path: string;
}) {
  return (
    <button
      type="button"
      className="task-button"
      aria-label={label}
      aria-disabled={isDisabled || undefined}
      data-task-button={focusKey}
      onClick={() => {
        if (!isDisabled) onClick();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}
