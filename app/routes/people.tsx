import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/people";
import { useAccount } from "../account/use-account";
import { AppMenu } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import {
  FloatingMessages,
  useFloatingMessages,
} from "../projects/floating-messages";
import {
  describePerson,
  findSubtitle,
  personJobTitleMaxLength,
  personNameMaxLength,
  type Person,
} from "../projects/people";
import {
  describePersonFailure,
  type PersonFailure,
} from "../projects/people-messages";
import { usePeople, type PeopleSource } from "../projects/use-people";

export const meta: Route.MetaFunction = () => [
  { title: "People - Abodeo" },
  { name: "description", content: "Who projects can be assigned to." },
];

// Removing someone assigned to projects, waiting for a confirmation.
type Removal = {
  // Where the count was taken, so that it is not confirmed against another
  // list if the account changes.
  storeKey: string;
  person: Person;
  count: number;
  unreadable: number;
  // Set when the count changed after it was first shown.
  notice?: string;
};

export function describeRemoval({
  person,
  count,
  unreadable,
}: Pick<Removal, "person" | "count" | "unreadable">) {
  const name = describePerson(person);
  const assigned =
    count === 0
      ? `${name} is not assigned to any project.`
      : count === 1
        ? `${name} is assigned to 1 project. Removing ${name} sets it to Unassigned.`
        : `${name} is assigned to ${count} projects. Removing ${name} sets them to Unassigned.`;
  const left =
    unreadable === 0
      ? ""
      : unreadable === 1
        ? " 1 project could not be read and was not changed."
        : ` ${unreadable} projects could not be read and were not changed.`;
  return assigned + left;
}

export default function People() {
  // Nothing on this screen is left unsaved.
  const leavePeople = async () => true;
  const account = useAccount({ onBeforeLeave: leavePeople });
  const source = usePeople(account.view, { onAccountFailure: account.recheck });
  const { view } = source;
  const isSignedIn = account.view.kind === "signed-in";
  const storeKey =
    account.view.kind === "signed-in" ? account.view.id : "browser";
  const [shownRemoval, setRemoval] = useState<Removal | null>(null);
  const removal = shownRemoval?.storeKey === storeKey ? shownRemoval : null;
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { boxes: messageBoxes, showMessage } = useFloatingMessages();

  const fail = (reason: PersonFailure) =>
    setMessage(describePersonFailure(reason));

  // The person being dragged, and where they would go: before the person at
  // this index, or at the end.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const movePerson = async (id: string, toIndex: number) => {
    setMessage(null);
    const result = await source.movePerson(id, toIndex);
    if (!result.ok) fail(result.reason);
  };

  const endDrag = () => {
    setDraggedId(null);
    setDropIndex(null);
  };

  const dropPerson = () => {
    if (view.status === "ready" && draggedId && dropIndex !== null) {
      const from = view.people.findIndex(({ id }) => id === draggedId);
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (from !== -1 && to !== from) void movePerson(draggedId, to);
    }
    endDrag();
  };

  const startRemoval = async (person: Person) => {
    setMessage(null);
    setRemoval(null);
    setBusyId(person.id);
    const counted = await source.countAssignedProjects(person.id);
    if (!counted.ok) {
      setBusyId(null);
      fail(counted.reason);
      return;
    }
    setBusyId(null);
    setRemoval({ storeKey, person, ...counted });
  };

  const finishRemoval = async (confirmed: Removal) => {
    if (confirmed.storeKey !== storeKey) return;
    setBusyId(confirmed.person.id);
    const result = await source.removePerson(
      confirmed.person.id,
      confirmed.count,
    );
    setBusyId(null);
    if (result.ok) {
      setRemoval(null);
      showMessage(`${describePerson(confirmed.person)} was removed.`);
    } else if (result.reason === "count-changed") {
      setRemoval({
        storeKey: confirmed.storeKey,
        person: confirmed.person,
        count: result.count,
        unreadable: result.unreadable,
        notice: "The projects assigned to them changed. Please check again.",
      });
    } else {
      setRemoval(null);
      fail(result.reason);
    }
  };

  return (
    <div className="dashboard people-page">
      <header>
        <h1>
          <Link to="/dashboard">
            <img
              src={logo}
              alt="Abodeo - Your home, sorted."
              width={997}
              height={868}
            />
          </Link>
        </h1>
        <AppMenu
          current="/people"
          account={account}
          onBeforeLeave={leavePeople}
        />
      </header>
      <main>
        <div className="dashboard-toolbar">
          <h2>People</h2>
        </div>
        <p className="people-hint">
          Projects can be assigned to the people listed here.{" "}
          {isSignedIn
            ? "They are kept in your account."
            : "They are kept in this browser."}
        </p>
        {view.status === "loading" && <p role="status">Loading…</p>}
        {view.status === "unavailable" && (
          <p className="dashboard-notice" role="alert">
            Your people cannot be loaded right now. Please try again later.
          </p>
        )}
        {view.status === "unreadable" && (
          <p className="dashboard-notice" role="alert">
            The saved list of people cannot be read, so it has been left as it
            is and cannot be changed.
          </p>
        )}
        {message && (
          <p className="people-message" role="status">
            {message}
          </p>
        )}
        {removal && (
          <div
            className="people-confirm dashboard-notice"
            role="alertdialog"
            aria-label={`Remove ${describePerson(removal.person)}`}
          >
            {removal.notice && <p>{removal.notice}</p>}
            <p>{describeRemoval(removal)}</p>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void finishRemoval(removal)}
            >
              Remove
            </button>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => setRemoval(null)}
            >
              Cancel
            </button>
          </div>
        )}
        {view.status === "ready" && (
          <>
            {view.people.length === 0 ? (
              <p className="people-empty">No people added yet.</p>
            ) : (
              <ul
                className="people-list"
                aria-label="People"
                onDragOver={(event) => {
                  if (!draggedId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (!draggedId) return;
                  event.preventDefault();
                  dropPerson();
                }}
              >
                {view.people.map((person, index) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    index={index}
                    count={view.people.length}
                    isDragged={person.id === draggedId}
                    dropEdge={
                      dropIndex === index
                        ? "before"
                        : dropIndex === view.people.length &&
                            index === view.people.length - 1
                          ? "after"
                          : null
                    }
                    isDragging={draggedId !== null}
                    onDragStart={() => setDraggedId(person.id)}
                    onDragOver={(isLowerHalf) =>
                      setDropIndex(isLowerHalf ? index + 1 : index)
                    }
                    onDragEnd={endDrag}
                    onMove={(step) => void movePerson(person.id, index + step)}
                    isBusy={busyId !== null}
                    source={source}
                    onMessage={setMessage}
                    onRemove={() => void startRemoval(person)}
                  />
                ))}
              </ul>
            )}
            <AddPersonForm
              source={source}
              onMessage={setMessage}
              showMessage={showMessage}
            />
          </>
        )}
      </main>
      <FloatingMessages boxes={messageBoxes} />
    </div>
  );
}

function PersonRow({
  person,
  index,
  count,
  isDragged,
  dropEdge,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMove,
  isBusy,
  source,
  onMessage,
  onRemove,
}: {
  person: Person;
  index: number;
  count: number;
  isDragged: boolean;
  dropEdge: "before" | "after" | null;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (isLowerHalf: boolean) => void;
  onDragEnd: () => void;
  onMove: (step: -1 | 1) => void;
  isBusy: boolean;
  source: PeopleSource;
  onMessage: (message: string | null) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [jobTitleDraft, setJobTitleDraft] = useState("");
  const [problem, setProblem] = useState<PersonFailure | null>(null);
  const inputId = useId();
  const jobTitleInputId = useId();
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const stopEditing = () => {
    setDraft(null);
    setProblem(null);
    // The input is about to go, so focus moves back to the button.
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = async () => {
    if (draft === null) return;
    onMessage(null);
    const result = await source.renamePerson(person.id, draft, jobTitleDraft);
    if (result.ok) stopEditing();
    else setProblem(result.reason);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      stopEditing();
    }
  };

  if (draft === null) {
    return (
      <li
        className={[
          "people-row",
          isDragged && "is-dragged",
          dropEdge === "before" && "drops-before",
          dropEdge === "after" && "drops-after",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={(event) => {
          if (!isDragging) return;
          const box = event.currentTarget.getBoundingClientRect();
          onDragOver(event.clientY > box.top + box.height / 2);
        }}
      >
        <span
          className="task-drag"
          draggable
          aria-hidden="true"
          title="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-abodeo-person",
              person.id,
            );
            const row = event.currentTarget.closest("li");
            if (row) event.dataTransfer.setDragImage(row, 12, 12);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
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
        <span className="people-name">
          {describePerson(person)}
          {findSubtitle(person) && (
            <span className="people-job-title">{findSubtitle(person)}</span>
          )}
        </span>
        <span className="task-controls">
          <button
            type="button"
            className="task-button"
            aria-label={`Move ${describePerson(person)} up`}
            aria-disabled={index === 0 || undefined}
            onClick={() => {
              if (index > 0) onMove(-1);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13V3M4 7l4-4 4 4" />
            </svg>
          </button>
          <button
            type="button"
            className="task-button"
            aria-label={`Move ${describePerson(person)} down`}
            aria-disabled={index === count - 1 || undefined}
            onClick={() => {
              if (index < count - 1) onMove(1);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M4 9l4 4 4-4" />
            </svg>
          </button>
        </span>
        <button
          ref={editButtonRef}
          type="button"
          aria-label={`Rename ${describePerson(person)}`}
          disabled={isBusy}
          onClick={() => {
            setDraft(person.name);
            setJobTitleDraft(person.jobTitle ?? "");
          }}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Remove ${describePerson(person)}`}
          disabled={isBusy}
          onClick={onRemove}
        >
          Remove
        </button>
      </li>
    );
  }

  return (
    <li className="people-row is-editing">
      <label htmlFor={inputId} className="people-edit-label">
        Name for {describePerson(person)} (required unless only job title known)
      </label>
      <input
        id={inputId}
        value={draft}
        maxLength={personNameMaxLength + 10}
        autoComplete="off"
        autoFocus
        aria-invalid={problem !== null}
        onChange={(event) => {
          setDraft(event.target.value);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
      />
      <label htmlFor={jobTitleInputId} className="people-edit-label">
        Job title for {describePerson(person)} (optional)
      </label>
      <input
        id={jobTitleInputId}
        value={jobTitleDraft}
        maxLength={personJobTitleMaxLength + 10}
        autoComplete="off"
        onChange={(event) => setJobTitleDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" onClick={() => void save()}>
        Save
      </button>
      <button type="button" onClick={stopEditing}>
        Cancel
      </button>
      {problem && (
        <p className="people-error" role="alert">
          {describePersonFailure(problem)}
        </p>
      )}
    </li>
  );
}

function AddPersonForm({
  source,
  onMessage,
  showMessage,
}: {
  source: PeopleSource;
  onMessage: (message: string | null) => void;
  showMessage: (message: string) => void;
}) {
  const id = useId();
  const jobTitleId = useId();
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [problem, setProblem] = useState<PersonFailure | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  return (
    <form
      className="people-add"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (isAdding) return;
        setIsAdding(true);
        onMessage(null);
        const result = await source.addPerson(name, jobTitle);
        setIsAdding(false);
        if (result.ok) {
          setName("");
          setJobTitle("");
          setProblem(null);
          showMessage(`${describePerson(result.person)} was added.`);
        } else {
          setProblem(result.reason);
        }
      }}
    >
      <label htmlFor={id}>
        Add a person (required unless only job title known)
      </label>
      <input
        id={id}
        value={name}
        maxLength={personNameMaxLength + 10}
        autoComplete="off"
        aria-invalid={problem !== null}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
      />
      <label htmlFor={jobTitleId}>Job title (optional)</label>
      <input
        id={jobTitleId}
        value={jobTitle}
        maxLength={personJobTitleMaxLength + 10}
        autoComplete="off"
        onChange={(event) => setJobTitle(event.target.value)}
      />
      <button type="submit" disabled={isAdding}>
        Add
      </button>
      {problem && (
        <p className="people-error" role="alert">
          {describePersonFailure(problem)}
        </p>
      )}
    </form>
  );
}
