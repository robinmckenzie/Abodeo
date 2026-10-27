import { checkPersonDetails, createPersonId, readPersonDetails, type Person, type PersonDetails } from "./people";
import { classifyPersonInput } from "./people-quick-add";
import { describePersonFailure } from "./people-messages";
import type { PeopleSource } from "./use-people";

export type PersonDraft = {
  values: PersonDetails;
  generation: number;
  dirty: boolean;
  status: "pending" | "saving" | "invalid" | "failed" | "saved";
  problem?: string;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  deleting?: boolean;
};

// A controller belongs to one store for its entire lifetime. UI expansion and
// list position do not own drafts or writes. Responses acknowledge generations.
export class PeopleDrafts {
  readonly drafts = new Map<string, PersonDraft>();
  source: PeopleSource;
  people: Person[];
  quickAdd = "";
  addFlight?: Promise<void>;
  submission: { input: string; id: string } | null = null;
  generation = 0;
  departing = false;
  private approval: number | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(readonly storeKey: string, source: PeopleSource) {
    this.source = source;
    this.people = source.view.status === "ready" ? source.view.people : [];
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.version;
  private notify() {
    this.version++;
    this.listeners.forEach(listener => listener());
  }
  configure(source: PeopleSource) {
    this.source = source;
    if (source.view.status === "ready") this.people = source.view.people;
  }
  get(person: Person) { return this.drafts.get(person.id)?.values ?? readPersonDetails(person); }
  private check(id: string, values: PersonDetails) {
    return checkPersonDetails(values, this.people.filter(person => person.id !== id));
  }
  edit(person: Person, values: PersonDetails) {
    if (this.departing || this.drafts.get(person.id)?.deleting) return;
    const previous = this.drafts.get(person.id);
    clearTimeout(previous?.timer);
    const checked = this.check(person.id, values);
    const draft: PersonDraft = {
      values, generation: ++this.generation, dirty: true,
      status: checked.ok ? "pending" : "invalid",
      problem: checked.ok ? undefined : describePersonFailure(checked.problem),
      flight: previous?.flight,
    };
    this.approval = null;
    this.drafts.set(person.id, draft);
    if (checked.ok) draft.timer = setTimeout(() => { void this.save(person.id); }, 500);
    this.notify();
  }
  setQuickAdd(value: string) {
    if (this.departing) return;
    this.quickAdd = value;
    this.generation++;
    this.approval = null;
    this.notify();
  }
  acknowledgeAdd() {
    this.quickAdd = "";
    this.submission = null;
    this.generation++;
    this.approval = null;
    this.notify();
  }
  async add() {
    if (this.addFlight || this.departing) return { ok: false as const, reason: "unavailable" as const };
    const input = this.quickAdd;
    if (this.submission?.input !== input) this.submission = { input, id: createPersonId() };
    const { name, jobTitle } = classifyPersonInput(input);
    const id = this.submission.id;
    const result = this.source.addPerson(name, jobTitle, id).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
    this.addFlight = result.then(answer => {
      if (answer.ok) this.acknowledgeAdd();
    }).finally(() => { this.addFlight = undefined; this.notify(); });
    this.notify();
    const answer = await result;
    await this.addFlight;
    return answer;
  }
  async save(id: string): Promise<void> {
    let draft = this.drafts.get(id);
    if (!draft || !draft.dirty || draft.deleting) return;
    clearTimeout(draft.timer);
    if (draft.flight) {
      await draft.flight;
      draft = this.drafts.get(id);
      if (!draft || !draft.dirty || draft.deleting || draft.status === "failed") return;
      return this.save(id);
    }
    const checked = this.check(id, draft.values);
    if (!checked.ok) {
      draft.status = "invalid";
      draft.problem = describePersonFailure(checked.problem);
      this.notify();
      return;
    }
    const generation = draft.generation;
    draft.status = "saving";
    draft.problem = undefined;
    const source = this.source;
    // Start on a microtask so even a synchronous storage result has its flight
    // registered before its acknowledgement can clear it.
    const flight = Promise.resolve().then(async () => {
      let result;
      try { result = await source.updateDetails(id, checked.details); }
      catch { result = { ok: false as const, reason: "unavailable" as const }; }
      const latest = this.drafts.get(id);
      if (!latest) return;
      latest.flight = undefined;
      if (latest.generation === generation) {
        latest.dirty = !result.ok;
        latest.status = result.ok ? "saved" : "failed";
        latest.problem = result.ok ? undefined : describePersonFailure(result.reason);
      }
      this.notify();
      if (latest.generation !== generation && !latest.deleting) void this.save(id);
    });
    draft.flight = flight;
    this.notify();
    await flight;
  }
  unresolved() { return !!this.addFlight || this.quickAdd !== "" || [...this.drafts.values()].some(draft => draft.dirty || draft.flight); }
  approved() { return this.departing && this.approval === this.generation; }
  beginDeparture() { this.departing = true; this.notify(); }
  approveDeparture() { this.approval = this.generation; this.notify(); }
  resume = () => { this.departing = false; this.approval = null; this.notify(); };
  async flush() {
    await this.addFlight;
    await Promise.all([...this.drafts.keys()].map(id => this.save(id)));
  }
  async prepareRemoval(id: string) {
    const draft = this.drafts.get(id);
    if (!draft) return;
    draft.deleting = true;
    clearTimeout(draft.timer);
    this.notify();
    await draft.flight;
  }
  finishRemoval(id: string, success: boolean) {
    const draft = this.drafts.get(id);
    if (success) this.drafts.delete(id);
    else if (draft) {
      draft.deleting = false;
      if (draft.dirty && draft.status !== "invalid") { draft.status = "failed"; draft.problem = "Deletion failed. Your edits are retained. Retry saving or deleting."; }
    }
    this.notify();
  }
  dispose() { this.drafts.forEach(draft => clearTimeout(draft.timer)); }
}
