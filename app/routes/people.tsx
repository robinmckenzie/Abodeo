import { useId, useRef, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/people";
import { useAccount } from "../account/use-account";
import { AppMenu } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import { personNameMaxLength, type Person } from "../projects/people";
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
  person: Person;
  count: number;
  unreadable: number;
  // Set when the count changed after it was first shown.
  notice?: string;
};

export function describeRemoval({ person, count, unreadable }: Removal) {
  const assigned =
    count === 0
      ? `${person.name} is not assigned to any project.`
      : count === 1
        ? `${person.name} is assigned to 1 project. Removing ${person.name} sets it to Unassigned.`
        : `${person.name} is assigned to ${count} projects. Removing ${person.name} sets them to Unassigned.`;
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
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fail = (reason: PersonFailure) =>
    setMessage(describePersonFailure(reason));

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
    if (counted.count === 0) {
      await finishRemoval({ person, ...counted });
      return;
    }
    setBusyId(null);
    setRemoval({ person, ...counted });
  };

  const finishRemoval = async (confirmed: Removal) => {
    setBusyId(confirmed.person.id);
    const result = await source.removePerson(
      confirmed.person.id,
      confirmed.count,
    );
    setBusyId(null);
    if (result.ok) {
      setRemoval(null);
      setMessage(`${confirmed.person.name} was removed.`);
    } else if (result.reason === "count-changed") {
      setRemoval({
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
            aria-label={`Remove ${removal.person.name}`}
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
              <ul className="people-list" aria-label="People">
                {view.people.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    isBusy={busyId !== null}
                    source={source}
                    onMessage={setMessage}
                    onRemove={() => void startRemoval(person)}
                  />
                ))}
              </ul>
            )}
            <AddPersonForm source={source} onMessage={setMessage} />
          </>
        )}
      </main>
    </div>
  );
}

function PersonRow({
  person,
  isBusy,
  source,
  onMessage,
  onRemove,
}: {
  person: Person;
  isBusy: boolean;
  source: PeopleSource;
  onMessage: (message: string | null) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<PersonFailure | null>(null);
  const inputId = useId();
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
    const result = await source.renamePerson(person.id, draft);
    if (result.ok) stopEditing();
    else setProblem(result.reason);
  };

  if (draft === null) {
    return (
      <li className="people-row">
        <span className="people-name">{person.name}</span>
        <button
          ref={editButtonRef}
          type="button"
          aria-label={`Rename ${person.name}`}
          disabled={isBusy}
          onClick={() => setDraft(person.name)}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Remove ${person.name}`}
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
        Name for {person.name}
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
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            stopEditing();
          }
        }}
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
}: {
  source: PeopleSource;
  onMessage: (message: string | null) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
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
        const result = await source.addPerson(name);
        setIsAdding(false);
        if (result.ok) {
          setName("");
          setProblem(null);
          onMessage(`${result.person.name} was added.`);
        } else {
          setProblem(result.reason);
        }
      }}
    >
      <label htmlFor={id}>Add a person</label>
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
