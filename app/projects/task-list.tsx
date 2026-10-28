// An opened project's tasks: a checklist below its notes, with a box below
// it for adding tasks, several at once, one per line. Each change is saved
// straight away by the dashboard, which shows it at once and puts it back if
// saving fails.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { calculateDragScroll } from "./drag-scroll";
import { ArrowIcon, BinIcon, DragHandleIcon } from "../ui/icons";
import { canAnimate } from "./project-bar";
import { calculateSlideStagger, slideTiming } from "./slide-timing";
import {
  addTasks,
  createTasks,
  deleteTask,
  isReordered,
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

// Whether any project has such text, which leaving the page would lose.
export function hasUnsubmittedTaskText() {
  return [...unsubmittedText.values()].some((text) => text.trim() !== "");
}

// Identifies a task being dragged, so that only tasks can be dropped here,
// and a task dropped into a text field does not type its title there.
const dragType = "application/x-abodeo-task";

const liftedLook: Keyframe = {
  zIndex: 1,
  background: "#fff",
  boxShadow: "0 4px 18px rgb(26 26 26 / 0.08)",
};

// Up and Down move focus between the tasks' titles.
const titleSteps: Partial<Record<string, -1 | 1>> = {
  ArrowUp: -1,
  ArrowDown: 1,
};

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
  // the edit. Gives the reason saving failed, or null once saved.
  finishEditRef?: React.RefObject<(() => Promise<string | null>) | null>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const entryRef = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Each task's place in the list as last shown, from which a reordered
  // task slides to its new place.
  const rowTopsRef = useRef(new Map<string, number>());
  const [text, setText] = useState(() => unsubmittedText.get(projectId) ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  // Mirrors editing, so that an edit finished by Enter is not finished again
  // by the blur that follows.
  const editingRef = useRef(editing);
  // Where in the title an edit starts typing: where it was clicked, or, if
  // not known, the end.
  const caretRef = useRef<number | null>(null);
  // The task being moved by dragging or a Move button, whose slide goes
  // last.
  const movedIdRef = useRef<string | null>(null);
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
    const fitText = () => fitHeightToText(entry);
    if (entry.getClientRects().length > 0) {
      fitText();
      // Kept in view as it grows, and after tasks are added above it.
      if (document.activeElement === entry) {
        entry.scrollIntoView?.({ block: "nearest" });
      }
      return;
    }
    entry.style.height = "";
    const frame = requestAnimationFrame(fitText);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  // When the tasks are reordered, each one that moved slides from its old
  // place to its new one, in turn as a wave: those moving down from the
  // bottom up, and those moving up from the top down, so that the wave
  // starts where the moved task was. The task moved here, by dragging or a
  // Move button, goes last, into the room the others make for it.
  useLayoutEffect(() => {
    const before = rowTopsRef.current;
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(":scope > .task") ??
        []),
    ];
    rowTopsRef.current = new Map(
      rows.map((row) => [row.dataset.taskId ?? "", row.offsetTop]),
    );
    if (!isReordered([...before.keys()], tasks)) return;
    const movedId = movedIdRef.current;
    movedIdRef.current = null;
    const slides = rows
      .filter(canAnimate)
      .map((row) => {
        const top = before.get(row.dataset.taskId ?? "") ?? row.offsetTop;
        return { row, top, shift: top - row.offsetTop + findShift(row) };
      })
      .filter(({ shift }) => shift !== 0);
    const slide = (
      row: HTMLElement,
      shift: number,
      delay: number,
      look: Keyframe = {},
    ) => {
      for (const animation of row.getAnimations()) animation.cancel();
      row.animate(
        [
          { ...look, transform: `translateY(${shift}px)` },
          { ...look, transform: "none" },
        ],
        { ...slideTiming, delay, fill: "backwards" },
      );
    };
    const rank = (shift: number, top: number) => (shift < 0 ? -top : top);
    const others = slides.filter(({ row }) => row.dataset.taskId !== movedId);
    const waves = [-1, 1].map((direction) =>
      others
        .filter(({ shift }) => Math.sign(shift) === direction)
        .sort((a, b) => rank(a.shift, a.top) - rank(b.shift, b.top)),
    );
    // The more places the task moves, the shorter the wait between slides.
    const places = Math.max(...waves.map((wave) => wave.length));
    const stagger = calculateSlideStagger(places);
    for (const wave of waves) {
      wave.forEach(({ row, shift }, turn) => slide(row, shift, turn * stagger));
    }
    const moved = slides.find(({ row }) => row.dataset.taskId === movedId);
    // Lifted above the others, which it waits on top of and then crosses.
    if (moved) slide(moved.row, moved.shift, places * stagger, liftedLook);
  });

  // A title being edited wraps, and its box grows or shrinks to fit it.
  useLayoutEffect(() => {
    if (titleInputRef.current) fitHeightToText(titleInputRef.current);
  }, [editing?.draft]);

  // A narrower window wraps the title onto more lines.
  const isEditing = editing !== null;
  useEffect(() => {
    if (!isEditing) return;
    const refit = () => {
      if (titleInputRef.current) fitHeightToText(titleInputRef.current);
    };
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [isEditing]);

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
    if (reason) return;
    isShowingAddedRef.current = true;
    changeText("");
  };

  // The list scrolls to show the tasks added at its end.
  const isShowingAddedRef = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!isShowingAddedRef.current || !list) return;
    isShowingAddedRef.current = false;
    list.scrollTop = list.scrollHeight;
  });

  const startEdit = (task: Task) => {
    const edit = { id: task.id, draft: task.title };
    editingRef.current = edit;
    setEditing(edit);
  };

  // A title is one line, so pasted line breaks become spaces.
  const changeDraft = (value: string) => {
    if (!editingRef.current) return;
    const draft = value.replace(/\r?\n/g, " ");
    const edit = { ...editingRef.current, draft };
    editingRef.current = edit;
    setEditing(edit);
  };

  // Saves the edit unless it is cancelled. An empty title, or one only
  // trimmed, leaves the title as it was.
  const finishEdit = async (isSaved: boolean) => {
    const edit = editingRef.current;
    if (!edit) return null;
    editingRef.current = null;
    setEditing(null);
    const task = tasks.find((current) => current.id === edit.id);
    const title = edit.draft.trim();
    if (isSaved && task && title && title !== task.title) {
      return save((current) => renameTask(current, edit.id, title));
    }
    return null;
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

  // If putting the task back cannot be saved, Undo is offered again.
  const undoDelete = async () => {
    if (!deleted) return;
    setDeleted(null);
    focusAfterRenderRef.current = titleSelector(deleted.task.id);
    const { task, index } = deleted;
    const reason = await save((current) => restoreTask(current, task, index));
    if (reason) {
      setDeleted({ task, index });
      focusAfterRenderRef.current = `#${CSS.escape(id)}-undo`;
    }
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
    movedIdRef.current = task.id;
    void save((current) =>
      moveTask(
        current,
        task.id,
        current.findIndex(({ id }) => id === task.id) + step,
      ),
    );
  };

  // While a task is dragged, scroll the list when the pointer is near its
  // edge or beyond it, which the browser would only do a few pixels from it.
  useEffect(() => {
    if (!draggedId) return;
    let pointerY: number | null = null;
    let frame = 0;
    const trackPointer = (event: DragEvent) => {
      pointerY = event.clientY;
    };
    const scroll = () => {
      const list = listRef.current;
      if (list && pointerY !== null) {
        const { top, bottom } = list.getBoundingClientRect();
        list.scrollTop += calculateDragScroll(pointerY, top, bottom);
      }
      frame = requestAnimationFrame(scroll);
    };
    window.addEventListener("dragover", trackPointer);
    frame = requestAnimationFrame(scroll);
    // The browser would also scroll the notes under the pointer.
    document.documentElement.dataset.draggingTask = "";
    return () => {
      window.removeEventListener("dragover", trackPointer);
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset.draggingTask;
    };
  }, [draggedId]);

  const endDrag = () => {
    setDraggedId(null);
    setDropIndex(null);
  };

  const dropTask = () => {
    const from = tasks.findIndex(({ id }) => id === draggedId);
    if (draggedId && from !== -1 && dropIndex !== null) {
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (to !== from) {
        movedIdRef.current = draggedId;
        void save((current) => moveTask(current, draggedId, to));
      }
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
          ref={listRef}
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
                data-task-id={task.id}
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
                  <DragHandleIcon />
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
                  <textarea
                    ref={titleInputRef}
                    className="task-title-input"
                    rows={1}
                    value={editing.draft}
                    aria-label={`Title of task ${task.title}`}
                    autoComplete="off"
                    autoFocus
                    onFocus={(event) => {
                      const at = caretRef.current ?? event.target.value.length;
                      caretRef.current = null;
                      event.target.setSelectionRange(at, at);
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
                    onClick={(event) => {
                      caretRef.current = findClickedCharacter(event);
                      startEdit(task);
                    }}
                    onKeyDown={(event) => {
                      const step = titleSteps[event.key];
                      if (!step) return;
                      // Also stops the page scrolling at the list's ends.
                      event.preventDefault();
                      const next = tasks[index + step];
                      if (next) {
                        document
                          .querySelector<HTMLElement>(titleSelector(next.id))
                          ?.focus();
                      }
                    }}
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
                    direction="up"
                  />
                  <TaskButton
                    label={`Move ${task.title} down`}
                    focusKey={`${task.id}1`}
                    isDisabled={index === tasks.length - 1}
                    onClick={() => moveBy(task, 1)}
                    direction="down"
                  />
                  <TaskButton
                    label={`Delete ${task.title}`}
                    focusKey={`${task.id}-delete`}
                    onClick={() => removeTask(task, index)}
                    isDelete
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
              className="button-secondary button-small"
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

// The position in an element's text that a click landed on, or null when
// it came from the keyboard or the browser cannot tell.
function findClickedCharacter(event: React.MouseEvent<HTMLElement>) {
  if (event.detail === 0) return null;
  const { clientX: x, clientY: y, currentTarget } = event;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && currentTarget.contains(position.offsetNode)
      ? position.offset
      : null;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && currentTarget.contains(range.startContainer)
    ? range.startOffset
    : null;
}

// How far a task is drawn from its place, part way through a slide.
function findShift(row: HTMLElement) {
  const transform = getComputedStyle(row).transform;
  return !transform || transform === "none" ? 0 : new DOMMatrix(transform).m42;
}

export function fitHeightToText(box: HTMLTextAreaElement) {
  box.style.height = "auto";
  const borders = box.offsetHeight - box.clientHeight;
  box.style.height = `${box.scrollHeight + borders}px`;
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
  direction,
  isDelete = false,
}: {
  label: string;
  // Finds the button again after the list changes, to give it focus.
  focusKey: string;
  isDisabled?: boolean;
  onClick: () => void;
  // The way a move arrow points; a delete button has the bin instead.
  direction?: "up" | "down";
  isDelete?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      aria-disabled={isDisabled || undefined}
      data-task-button={focusKey}
      onClick={() => {
        if (!isDisabled) onClick();
      }}
    >
      {isDelete ? <BinIcon /> : <ArrowIcon direction={direction ?? "up"} />}
    </button>
  );
}
