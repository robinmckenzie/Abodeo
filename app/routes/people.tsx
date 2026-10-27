import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/people";
import { useAccount } from "../account/use-account";
import { AppMenu } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import deleteIcon from "../images/delete-circle.svg";
import { FloatingMessages, useFloatingMessages } from "../projects/floating-messages";
import { describePerson, findSubtitle, type Person } from "../projects/people";
import { PeopleDrafts } from "../projects/people-drafts";
import { describePersonFailure } from "../projects/people-messages";
import { usePeople } from "../projects/use-people";
import { usePeopleDeparture } from "../projects/use-people-departure";

export const meta: Route.MetaFunction = () => [
  { title: "People - Abodeo" }, { name: "description", content: "Who projects can be assigned to." },
];
type Removal = { storeKey: string; person: Person; count: number; unreadable: number; notice?: string };
export function describeRemoval({ person, count, unreadable }: Pick<Removal, "person" | "count" | "unreadable">) {
  const name = describePerson(person);
  const assigned = count === 0 ? `${name} is not assigned to any project.`
    : count === 1 ? `${name} is assigned to 1 project. Removing ${name} sets it to Unassigned.`
      : `${name} is assigned to ${count} projects. Removing ${name} sets them to Unassigned.`;
  return assigned + (unreadable === 0 ? "" : unreadable === 1 ? " 1 project could not be read and was not changed." : ` ${unreadable} projects could not be read and were not changed.`);
}

export default function People() {
  const [stores] = useState(() => new Map<string, PeopleDrafts>());
  const departure = usePeopleDeparture(stores);
  const account = useAccount({ onBeforeLeave: departure.leave, onLeaveFailed: departure.resume });
  const source = usePeople(account.view, { onAccountFailure: account.recheck });
  const { view } = source;
  const identity = account.view.kind === "signed-in" ? account.view.id : account.view.kind === "signed-out" || account.view.kind === "not-configured" ? "browser" : null;
  const [controllers, setControllers] = useState<Map<string, PeopleDrafts>>(() => new Map());
  useEffect(() => {
    if (identity === null || view.status !== "ready") return;
    const store = stores.get(identity);
    if (store) store.configure(source);
    else {
      stores.set(identity, new PeopleDrafts(identity, source));
      queueMicrotask(() => setControllers(new Map(stores)));
    }
  }, [identity, view, source, stores]);
  const controller = identity === null ? undefined : controllers.get(identity);
  return <div className="dashboard people-page">
    <header><h1><Link to="/dashboard"><img src={logo} alt="Abodeo - Your home, sorted." width={997} height={868} /></Link></h1>
      <AppMenu current="/people" account={account} onBeforeLeave={departure.leave} onLeaveFailed={departure.resume} />
    </header>
    <main><div className="dashboard-toolbar"><h2>People</h2></div>
      <p className="people-hint">Projects can be assigned to the people listed here. {account.view.kind === "signed-in" ? "They are kept in your account." : "They are kept in this browser."}</p>
      {view.status === "loading" && <p role="status">Loading...</p>}
      {view.status === "unavailable" && <p role="alert">Your people cannot be loaded right now. Please try again later.</p>}
      {view.status === "unreadable" && <p role="alert">The saved list of people cannot be read, so it has been left as it is and cannot be changed.</p>}
      {view.status === "ready" && controller && <PeoplePanel key={controller.storeKey} controller={controller} people={view.people} disabled={departure.departing} />}
      {[...controllers].filter(([key, store]) => key !== identity && store.unresolved()).map(([key]) => <p key={key} role="alert">Unsaved People edits are retained for the previous account. Return to that account to correct or retry them before leaving.</p>)}
    </main>
  </div>;
}

function PeoplePanel({ controller, people, disabled }: { controller: PeopleDrafts; people: Person[]; disabled: boolean }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const source = controller.source;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { boxes, showMessage } = useFloatingMessages();
  const isDisabled = disabled || controller.departing;
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const editor = panel.current?.querySelector(".people-item.is-expanded");
      if (!editor?.contains(event.target as Node)) setExpanded(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const add = async () => {
    if (addingRef.current || controller.departing) return;
    addingRef.current = true;
    setAdding(true);
    setMessage(null);
    try {
      const result = await controller.add();
      if (result.ok) showMessage(`${describePerson(result.person)} was added.`);
      else setMessage(describePersonFailure(result.reason));
    } catch { setMessage("Not saved. Please try again."); }
    finally { addingRef.current = false; setAdding(false); }
  };
  const move = async (id: string, index: number) => {
    if (controller.departing) return;
    const result = await source.movePerson(id, index);
    if (!result.ok) setMessage(describePersonFailure(result.reason));
  };
  const startRemoval = async (person: Person) => {
    if (controller.departing) return;
    setBusyId(person.id);
    const result = await source.countAssignedProjects(person.id);
    setBusyId(null);
    if (result.ok) setRemoval({ storeKey: controller.storeKey, person, ...result });
    else setMessage(describePersonFailure(result.reason));
  };
  const finishRemoval = async (confirmed: Removal) => {
    if (controller.departing) return;
    setBusyId(confirmed.person.id);
    await controller.prepareRemoval(confirmed.person.id);
    const result = await source.removePerson(confirmed.person.id, confirmed.count);
    controller.finishRemoval(confirmed.person.id, result.ok);
    setBusyId(null);
    if (result.ok) { setRemoval(null); showMessage(`${describePerson(confirmed.person)} was removed.`); }
    else if (result.reason === "count-changed") setRemoval({ ...confirmed, count: result.count, unreadable: result.unreadable, notice: "The projects assigned to them changed. Please check again." });
    else setMessage(describePersonFailure(result.reason));
  };
  const endDrag = () => { setDraggedId(null); setDropIndex(null); };
  return <div className="people-panel" ref={panel}>
    <h3>Add person</h3>
    <form className="people-quick-add" noValidate onSubmit={event => { event.preventDefault(); void add(); }}>
      <input aria-label="Name or job title" placeholder="Name or job title..." value={controller.quickAdd} disabled={isDisabled || adding} autoComplete="off" onChange={event => { controller.setQuickAdd(event.target.value); setMessage(null); }} />
      <button type="submit" disabled={isDisabled || adding}><span aria-hidden="true">＋ </span>Add</button>
    </form>
    {message && <p className="people-error" role="alert">{message}</p>}<hr />
    {people.length === 0 ? <p className="people-empty">No people added yet.</p> : <ul className="people-list" aria-label="People"
      onDragOver={event => { if (draggedId && !isDisabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={event => { event.preventDefault(); if (draggedId && dropIndex !== null && !isDisabled) { const from = people.findIndex(person => person.id === draggedId); const to = dropIndex > from ? dropIndex - 1 : dropIndex; if (from !== -1 && to !== from) void move(draggedId, to); } endDrag(); }}>
      {people.map((person, index) => {
        const draft = controller.drafts.get(person.id);
        const values = controller.get(person);
        const name = describePerson(person);
        const open = expanded === person.id;
        const locked = isDisabled || busyId === person.id || draft?.deleting;
        return <li key={person.id} className={`people-item${open ? " is-expanded" : ""}${dropIndex === index ? " drops-before" : ""}${dropIndex === people.length && index === people.length - 1 ? " drops-after" : ""}${draggedId === person.id ? " is-dragged" : ""}`}
          onDragOver={event => { if (draggedId) { const box = event.currentTarget.getBoundingClientRect(); setDropIndex(event.clientY > box.top + box.height / 2 ? index + 1 : index); } }}>
          <div className="people-compact-row">
            <span className="task-drag" draggable={!locked} aria-hidden="true" title="Drag to reorder" onDragStart={event => { if (locked) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-abodeo-person", person.id); const row = event.currentTarget.closest("li"); if (row) event.dataTransfer.setDragImage(row, 12, 12); setDraggedId(person.id); }} onDragEnd={endDrag}>
              <svg viewBox="0 0 10 16">{[3, 8, 13].flatMap(y => [3, 7].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.25" />))}</svg>
            </span>
            <button type="button" className="people-expand" aria-label={`Details for ${name}`} aria-expanded={open} aria-controls={`person-${person.id}`} disabled={isDisabled} onClick={() => setExpanded(open ? null : person.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></svg>
              <span className="people-name">{name}{findSubtitle(person) && <span className="people-job-title">{findSubtitle(person)}</span>}</span>
            </button>
            <span className="task-controls">
              <button type="button" className="task-button" disabled={locked || index === 0} aria-label={`Move ${name} up`} onClick={() => void move(person.id, index - 1)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg></button>
              <button type="button" className="task-button" disabled={locked || index === people.length - 1} aria-label={`Move ${name} down`} onClick={() => void move(person.id, index + 1)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4" /></svg></button>
            </span>
            <button type="button" className="people-delete" aria-label={`Delete ${name}`} disabled={locked} onClick={() => void startRemoval(person)}><img src={deleteIcon} alt="" width="26" height="26" /></button>
          </div>
          {removal?.person.id === person.id && <div className="people-confirm" role="alertdialog" aria-label={`Remove ${name}`}>
            {removal.notice && <p>{removal.notice}</p>}<p>{describeRemoval(removal)}</p><div><button type="button" disabled={locked} onClick={() => void finishRemoval(removal)}>Remove</button><button type="button" disabled={locked} onClick={() => setRemoval(null)}>Cancel</button></div>
          </div>}
          {open && <div id={`person-${person.id}`} className="people-editor"><fieldset disabled={locked}>
            <div className="people-name-fields">
              <label>Name<input value={values.name} autoComplete="off" onChange={event => controller.edit(person, { ...values, name: event.target.value })} /></label>
              <button type="button" className="people-swap" aria-label="Swap name and job title" onClick={() => controller.edit(person, { ...values, name: values.jobTitle, jobTitle: values.name })}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M6 8h12m-3-3 3 3-3 3M18 16H6m3-3-3 3 3 3" /></svg></button>
              <label>Job Title<input value={values.jobTitle} autoComplete="off" onChange={event => controller.edit(person, { ...values, jobTitle: event.target.value })} /></label>
            </div>
            <div className="people-contact-fields"><label>Phone number<input type="tel" value={values.phone} onChange={event => controller.edit(person, { ...values, phone: event.target.value })} /></label><label>Email<input type="email" value={values.email} onChange={event => controller.edit(person, { ...values, email: event.target.value })} /></label></div>
          </fieldset></div>}
          {draft && <div className={`people-save-status people-save-${draft.status}`} role={draft.status === "invalid" || draft.status === "failed" ? "alert" : "status"}>
            {draft.status === "pending" ? "Not saved yet..." : draft.status === "saving" ? "Saving..." : draft.status === "saved" ? "Saved." : draft.problem}
            {draft.status === "failed" && <button type="button" disabled={locked} onClick={() => void controller.save(person.id)}>Retry</button>}
          </div>}
        </li>;
      })}
    </ul>}<FloatingMessages boxes={boxes} />
  </div>;
}
