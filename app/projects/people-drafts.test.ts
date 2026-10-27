import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleDrafts } from "./people-drafts";
import { readPersonDetails, type PersonDetails } from "./people";
import type { PeopleSource } from "./use-people";

const person = { id: "andy", name: "Andy", jobTitle: "Builder" };
const initial = readPersonDetails(person);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const updateDetails = vi.fn<PeopleSource["updateDetails"]>().mockResolvedValue({ ok: true });
  const addPerson = vi.fn<PeopleSource["addPerson"]>().mockResolvedValue({ ok: true, person });
  const source = { view: { status: "ready", people: [person], isEstablished: true }, updateDetails, addPerson } as unknown as PeopleSource;
  const store = new PeopleDrafts("browser", source);
  return { store, source, updateDetails, addPerson };
}
afterEach(() => vi.useRealTimers());

describe("retained People drafts", () => {
  it("debounces and writes an entire swap together, including an empty field", async () => {
    vi.useFakeTimers();
    const { store, updateDetails } = setup();
    const swap = { ...initial, name: initial.jobTitle, jobTitle: "" };
    store.edit(person, swap);
    await vi.advanceTimersByTimeAsync(499);
    expect(updateDetails).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updateDetails).toHaveBeenCalledExactlyOnceWith("andy", swap);
    expect(store.drafts.get("andy")).toMatchObject({ dirty: false, status: "saved", values: swap });
  });
  it("keeps invalid latest values out of storage even when an older save completes", async () => {
    const { store, updateDetails } = setup();
    const response = deferred<{ ok: true }>();
    updateDetails.mockReturnValueOnce(response.promise);
    store.edit(person, { ...initial, name: "Andrew" });
    const saving = store.save(person.id);
    await Promise.resolve();
    store.edit(person, { ...initial, name: "", jobTitle: "" });
    response.resolve({ ok: true });
    await saving;
    expect(store.get(person)).toMatchObject({ name: "", jobTitle: "" });
    expect(store.drafts.get(person.id)).toMatchObject({ status: "invalid", dirty: true });
    expect(updateDetails).toHaveBeenCalledTimes(1);
    store.dispose();
  });
  it.each([true, false])("coalesces newer typing with one save in flight, older success=%s", async success => {
    const { store, updateDetails } = setup();
    const response = deferred<Awaited<ReturnType<PeopleSource["updateDetails"]>>>();
    updateDetails.mockReturnValueOnce(response.promise);
    store.edit(person, { ...initial, name: "Andrew" });
    const saving = store.save(person.id);
    await Promise.resolve();
    store.edit(person, { ...initial, name: "Andy New" });
    store.edit(person, { ...initial, name: "Newest" });
    const flush = store.flush();
    expect(updateDetails).toHaveBeenCalledTimes(1);
    response.resolve(success ? { ok: true } : { ok: false, reason: "unreachable" });
    await saving;
    await flush;
    expect(updateDetails).toHaveBeenCalledTimes(2);
    expect(updateDetails.mock.calls[1][1].name).toBe("Newest");
    expect(store.get(person).name).toBe("Newest");
    expect(store.unresolved()).toBe(false);
    store.dispose();
  });
  it("retains failed values and retries without re-entry", async () => {
    const { store, updateDetails } = setup();
    updateDetails.mockResolvedValueOnce({ ok: false, reason: "unreachable" });
    const values = { ...initial, phone: "+44 (0) 1234 567890", email: "andy@example.test" };
    store.edit(person, values);
    await store.save(person.id);
    expect(store.drafts.get(person.id)).toMatchObject({ status: "failed", values, dirty: true });
    await store.save(person.id);
    expect(updateDetails.mock.calls[1][1]).toEqual(values);
    expect(store.unresolved()).toBe(false);
  });
  it("stops queued writes before deletion and waits for an existing write", async () => {
    const { store, updateDetails } = setup();
    const response = deferred<{ ok: true }>();
    updateDetails.mockReturnValueOnce(response.promise);
    store.edit(person, { ...initial, name: "Andrew" });
    const saving = store.save(person.id);
    await Promise.resolve();
    store.edit(person, { ...initial, name: "Newest" });
    const removing = store.prepareRemoval(person.id);
    store.edit(person, initial);
    response.resolve({ ok: true });
    await removing;
    await saving;
    expect(updateDetails).toHaveBeenCalledTimes(1);
    store.finishRemoval(person.id, false);
    expect(store.get(person).name).toBe("Newest");
    await store.save(person.id);
    expect(updateDetails.mock.calls[1][1].name).toBe("Newest");
    store.finishRemoval(person.id, true);
    expect(store.drafts.has(person.id)).toBe(false);
  });
  it("retains raw quick-add and its ID on failure, and awaits an in-flight add on leave", async () => {
    const { store, addPerson } = setup();
    addPerson.mockResolvedValueOnce({ ok: false, reason: "unreachable" });
    store.setQuickAdd(" Electrician ");
    await store.add();
    expect(store.quickAdd).toBe(" Electrician ");
    const response = deferred<Awaited<ReturnType<PeopleSource["addPerson"]>>>();
    addPerson.mockReturnValueOnce(response.promise);
    const adding = store.add();
    store.beginDeparture();
    const flushed = vi.fn();
    const flush = store.flush().then(flushed);
    await Promise.resolve();
    expect(flushed).not.toHaveBeenCalled();
    response.resolve({ ok: true, person });
    await adding;
    await flush;
    expect(addPerson.mock.calls[1]).toEqual(addPerson.mock.calls[0]);
    expect(store.quickAdd).toBe("");
    expect(store.unresolved()).toBe(false);
  });
  it("scopes leave approval to this store and prevents newer edits until resumed", async () => {
    const { store, source } = setup();
    store.setQuickAdd("unfinished");
    store.beginDeparture();
    store.approveDeparture();
    store.setQuickAdd("newer");
    store.edit(person, { ...initial, name: "New" });
    expect(store.approved()).toBe(true);
    expect(store.quickAdd).toBe("unfinished");
    expect(store.drafts.size).toBe(0);
    expect(new PeopleDrafts("other-account", source).approved()).toBe(false);
    store.resume();
    expect(store.approved()).toBe(false);
    store.edit(person, { ...initial, name: "New" } as PersonDetails);
    expect(store.unresolved()).toBe(true);
    store.dispose();
  });
});
