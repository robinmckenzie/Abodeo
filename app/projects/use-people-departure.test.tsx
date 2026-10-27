import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleDrafts } from "./people-drafts";
import { usePeopleDeparture } from "./use-people-departure";
import type { PeopleSource } from "./use-people";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function setup() {
  const store = new PeopleDrafts("account-a", { view: { status: "ready", people: [], isEstablished: true } } as unknown as PeopleSource);
  store.setQuickAdd("unfinished");
  const stores = new Map([[store.storeKey, store]]);
  const endedSession = vi.fn();
  let guardedAfterSignOut: boolean | undefined;
  function Page() {
    const departure = usePeopleDeparture(stores);
    const navigate = useNavigate();
    return <>
      <button onClick={() => navigate("/done")}>Router back or logo</button>
      <button onClick={() => { void departure.leave().then(allowed => { if (allowed) { endedSession(); guardedAfterSignOut = unload(); } }); }}>Sign out</button>
      <button onClick={() => { void departure.leave().then(allowed => { if (allowed) departure.resume(); }); }}>Failed departure</button>
      <button onClick={() => store.setQuickAdd("new edits")}>Edit</button>
    </>;
  }
  const Stub = createRoutesStub([{ path: "/people", Component: Page }, { path: "/done", Component: () => <p>Done</p> }]);
  render(<Stub initialEntries={["/people"]} />);
  return { store, endedSession, guarded: () => guardedAfterSignOut };
}
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }

describe("People departure approval", () => {
  it("carries one Leave approval through router navigation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    setup();
    await click("Router back or logo");
    expect(screen.getByText("Done")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("allows Stay, keeps edits and restores native protection", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { store } = setup();
    await click("Router back or logo");
    expect(screen.queryByText("Done")).toBeNull();
    expect(store.quickAdd).toBe("unfinished");
    expect(store.departing).toBe(false);
    expect(unload()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("does not offer a native Stay after sign-out ends the session, and freezes edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { store, endedSession, guarded } = setup();
    await click("Sign out");
    expect(endedSession).toHaveBeenCalledTimes(1);
    expect(guarded()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    await click("Edit");
    expect(store.quickAdd).toBe("unfinished");
    expect(store.approved()).toBe(true);
  });
  it("restores protection and editing if approved departure fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { store } = setup();
    await click("Failed departure");
    expect(store.approved()).toBe(false);
    expect(unload()).toBe(true);
    await click("Edit");
    expect(store.quickAdd).toBe("new edits");
  });
  it("does not approve a different store's edits", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { store } = setup();
    store.beginDeparture(); store.approveDeparture();
    expect(store.approved()).toBe(true);
    store.resume();
    window.dispatchEvent(new Event("pageshow"));
    expect(unload()).toBe(true);
  });
});
