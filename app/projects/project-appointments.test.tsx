import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Appointment } from "../calendar/appointments-api";
import { resetAutomaticReconnects } from "../calendar/use-project-appointments";
import {
  appointmentsUnavailableMessage,
  describeAppointmentTime,
  findNextLocalHour,
  ProjectAppointments,
  signInToAddAppointmentsMessage,
  tokenEndedMessage,
} from "./project-appointments";

beforeEach(() => {
  resetAutomaticReconnects();
});

afterEach(() => {
  cleanup();
});

const visit: Appointment = {
  id: "e1",
  title: "Site visit",
  notes: "Bring keys",
  allDay: false,
  start: "2026-11-02T10:00:00Z",
  end: "2026-11-02T11:00:00Z",
};

type Call = { method: string; path: string; headers: Headers; body: unknown };

// Answers as the appointment endpoints would.
function fakeEndpoints() {
  const endpoints = {
    list: { status: "ok", appointments: [visit] } as unknown,
    listFails: false,
    connectionReady: true,
    createStatus: 200,
    createBody: { appointment: visit } as unknown,
    calls: [] as Call[],
  };
  const fetchFn = vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    endpoints.calls.push({
      method,
      path,
      headers: new Headers(init.headers),
      body,
    });
    if (path === "/api/calendar/connection") {
      return Response.json({ ready: endpoints.connectionReady });
    }
    if (path === "/api/calendar/test-appointment") {
      return Response.json({ url: "https://accounts.google.com/grant" });
    }
    if (path.startsWith("/api/calendar/appointments")) {
      if (method === "POST") {
        return Response.json(endpoints.createBody, {
          status: endpoints.createStatus,
        });
      }
      if (endpoints.listFails) throw new Error("offline");
      return Response.json(endpoints.list);
    }
    return new Response(null, { status: 404 });
  });
  const posts = () => endpoints.calls.filter(({ method }) => method === "POST");
  return { ...endpoints, fetchFn, posts, endpoints };
}

type Fakes = ReturnType<typeof fakeEndpoints>;

async function show(
  fakes: Fakes,
  props: Partial<React.ComponentProps<typeof ProjectAppointments>> = {},
) {
  const navigate = vi.fn();
  const onBeforeLeave = vi.fn(async () => true);
  const onSignInChange = vi.fn();
  render(
    <ProjectAppointments
      accountId="ada"
      projectId="p-1"
      fetchFn={fakes.fetchFn as unknown as typeof fetch}
      navigate={navigate}
      onBeforeLeave={onBeforeLeave}
      onSignInChange={onSignInChange}
      {...props}
    />,
  );
  await settle();
  return { navigate, onBeforeLeave, onSignInChange };
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settle();
}

describe("describeAppointmentTime", () => {
  it("says all day for a day, and gives a timed appointment's start and end", () => {
    const allDay = describeAppointmentTime({
      ...visit,
      allDay: true,
      start: "2026-11-01",
      end: "2026-11-02",
    });
    const timed = describeAppointmentTime(visit);

    expect(allDay).toMatch(/2026/);
    expect(allDay).toMatch(/all day$/);
    expect(timed).toContain(" to ");
    expect(timed).not.toMatch(/all day/);
  });
});

describe("findNextLocalHour", () => {
  it("is the start of the next hour on the clock", () => {
    expect(findNextLocalHour(new Date(2026, 10, 2, 9, 20))).toBe(
      "2026-11-02T10:00",
    );
    expect(findNextLocalHour(new Date(2026, 10, 2, 10, 0))).toBe(
      "2026-11-02T11:00",
    );
    expect(findNextLocalHour(new Date(2026, 11, 31, 23, 30))).toBe(
      "2027-01-01T00:00",
    );
  });
});

describe("the appointments section", () => {
  it("says to sign in while signed out, and asks Google for nothing", async () => {
    const fakes = fakeEndpoints();
    await show(fakes, { accountId: null });

    expect(screen.getByText(signInToAddAppointmentsMessage)).toBeTruthy();
    expect(fakes.fetchFn).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Add appointment" }),
    ).toBeNull();
  });

  it("lists the project's appointments, naming the account the page works for", async () => {
    const fakes = fakeEndpoints();
    await show(fakes);

    expect(screen.getByText("Site visit")).toBeTruthy();
    expect(screen.getByText("Bring keys")).toBeTruthy();
    const [list] = fakes.calls;
    expect(list.path).toBe("/api/calendar/appointments?projectId=p-1");
    expect(list.headers.get("X-Abodeo-Account")).toBe("ada");
  });

  it("says when there are none", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "ok", appointments: [] };
    await show(fakes);

    expect(screen.getByText("No appointments yet.")).toBeTruthy();
  });

  it("says appointments cannot be shown, never an empty list, when Google cannot be reached", async () => {
    const unavailable = fakeEndpoints();
    unavailable.endpoints.list = { status: "unavailable" };
    await show(unavailable);
    expect(screen.getByText(appointmentsUnavailableMessage)).toBeTruthy();
    expect(screen.queryByText("No appointments yet.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add appointment" }),
    ).toBeNull();
    cleanup();

    const offline = fakeEndpoints();
    offline.endpoints.listFails = true;
    await show(offline);
    expect(screen.getByText(appointmentsUnavailableMessage)).toBeTruthy();
    expect(screen.queryByText("No appointments yet.")).toBeNull();
  });

  it("tells the dashboard when the sign-in has changed", async () => {
    const fakes = fakeEndpoints();
    fakes.fetchFn.mockImplementationOnce(async () =>
      Response.json({ error: "account_changed" }, { status: 409 }),
    );
    const { onSignInChange } = await show(fakes);

    expect(onSignInChange).toHaveBeenCalledWith("account-changed");
    expect(screen.getByText(appointmentsUnavailableMessage)).toBeTruthy();
  });
});

describe("calling fetch", () => {
  it("calls it on its own, as the browser's fetch fails when called as a method", async () => {
    const fakes = fakeEndpoints();
    const receivers: unknown[] = [];
    const sendRequest = fakes.fetchFn.getMockImplementation()!;
    fakes.fetchFn.mockImplementation(function (this: unknown, ...args) {
      receivers.push(this);
      return sendRequest(...args);
    });
    await show(fakes);

    expect(receivers.length).toBeGreaterThan(0);
    expect(receivers.every((receiver) => receiver === undefined)).toBe(true);
  });
});

describe("leaving for Google", () => {
  it("does not go through Google after the project has been closed", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "needs-grant", connectedBefore: false };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = fakes.fetchFn.getMockImplementation()!;
    fakes.fetchFn.mockImplementation(async (path, init) => {
      if (path === "/api/calendar/test-appointment") await held;
      return answer(path, init);
    });
    const { navigate } = await show(fakes);

    fireEvent.click(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    );
    await settle();
    cleanup();
    release();
    await settle();

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("opening a project without a good Google token", () => {
  it("goes through Google by itself, once, for an account that connected before", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "needs-grant", connectedBefore: true };
    const { navigate, onBeforeLeave } = await show(fakes);

    expect(onBeforeLeave).toHaveBeenCalledTimes(1);
    expect(fakes.posts()).toHaveLength(1);
    expect(fakes.posts()[0].body).toMatchObject({
      projectId: "p-1",
      openForm: false,
    });
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/grant");
    cleanup();

    // Another project in the same page load: the Connect button instead.
    const second = await show(fakes, { projectId: "p-2" });
    expect(second.navigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeTruthy();
  });

  it("shows a Connect button, and does not go through Google, for an account that never connected", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "needs-grant", connectedBefore: false };
    const { navigate } = await show(fakes);

    expect(navigate).not.toHaveBeenCalled();
    expect(fakes.posts()).toHaveLength(0);

    await click("Connect Google Calendar");

    expect(fakes.posts()[0].body).toMatchObject({
      projectId: "p-1",
      openForm: false,
    });
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/grant");
  });

  it("does not go through Google by itself straight after a refusal or failure", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "needs-grant", connectedBefore: true };
    const { navigate } = await show(fakes, {
      canReconnectAutomatically: false,
      returnNote:
        "Calendar access was not given, so appointments cannot be shown.",
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Calendar access was not given, so appointments cannot be shown.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeTruthy();
  });

  it("stays, and shows the Connect button, if the person chooses not to leave", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.list = { status: "needs-grant", connectedBefore: true };
    const onBeforeLeave = vi.fn(async () => false);
    const { navigate } = await show(fakes, { onBeforeLeave });

    expect(navigate).not.toHaveBeenCalled();
    expect(fakes.posts()).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeTruthy();
  });
});

describe("adding an appointment", () => {
  it("opens the form when the token is good, with the end an hour after the start", async () => {
    const fakes = fakeEndpoints();
    const { onBeforeLeave } = await show(fakes);

    await click("Add appointment");

    expect(onBeforeLeave).not.toHaveBeenCalled();
    const start = screen.getByLabelText("Starts") as HTMLInputElement;
    const end = screen.getByLabelText("Ends") as HTMLInputElement;
    expect(start.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
    expect(end.value).toBeTruthy();
    expect(end.value).not.toBe(start.value);

    // The end follows the start until it is chosen.
    fireEvent.change(start, { target: { value: "2026-11-02T15:30" } });
    expect(end.value).toBe("2026-11-02T16:30");
    fireEvent.change(end, { target: { value: "2026-11-02T18:00" } });
    fireEvent.change(start, { target: { value: "2026-11-03T09:00" } });
    expect(end.value).toBe("2026-11-02T18:00");
  });

  it("saves a timed appointment, then shows the list as Google now has it", async () => {
    const fakes = fakeEndpoints();
    await show(fakes);
    await click("Add appointment");
    fireEvent.change(screen.getByLabelText("Appointment title"), {
      target: { value: "  Quote  " },
    });
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-11-02T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Front door" },
    });
    const before = fakes.calls.length;

    await click("Save");

    const [create] = fakes.posts();
    expect(create.body).toMatchObject({
      projectId: "p-1",
      title: "  Quote  ",
      notes: "Front door",
      allDay: false,
      start: "2026-11-02T10:00",
      end: "2026-11-02T11:00",
    });
    expect(create.headers.get("X-Abodeo-Account")).toBe("ada");
    // The list is fetched again, and the form has closed.
    expect(fakes.calls.slice(before).map(({ method }) => method)).toEqual([
      "POST",
      "GET",
    ]);
    expect(screen.queryByRole("group", { name: "New appointment" })).toBeNull();
  });

  it("saves an all-day appointment with a day", async () => {
    const fakes = fakeEndpoints();
    await show(fakes);
    await click("Add appointment");
    fireEvent.change(screen.getByLabelText("Appointment title"), {
      target: { value: "Delivery" },
    });
    fireEvent.click(screen.getByLabelText("All day"));
    expect(screen.queryByLabelText("Ends")).toBeNull();
    fireEvent.change(screen.getByLabelText("Day"), {
      target: { value: "2026-12-31" },
    });

    await click("Save");

    expect(fakes.posts()[0].body).toMatchObject({
      allDay: true,
      start: "2026-12-31",
    });
  });

  it("asks for a title and an end after the start, and sends nothing", async () => {
    const fakes = fakeEndpoints();
    await show(fakes);
    await click("Add appointment");

    await click("Save");
    expect(screen.getByRole("alert").textContent).toBe(
      "Give the appointment a title.",
    );

    fireEvent.change(screen.getByLabelText("Appointment title"), {
      target: { value: "Quote" },
    });
    fireEvent.change(screen.getByLabelText("Ends"), {
      target: { value: "2020-01-01T00:00" },
    });
    await click("Save");
    expect(screen.getByRole("alert").textContent).toBe(
      "The appointment must end after it starts.",
    );
    expect(fakes.posts()).toHaveLength(0);
  });

  it("goes through Google first, saving the page, when the token is missing or near expiry", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.connectionReady = false;
    const { navigate, onBeforeLeave } = await show(fakes);

    await click("Add appointment");

    expect(onBeforeLeave).toHaveBeenCalledTimes(1);
    expect(fakes.posts()[0].body).toMatchObject({
      projectId: "p-1",
      openForm: true,
    });
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/grant");
    expect(screen.queryByRole("group", { name: "New appointment" })).toBeNull();
  });

  it("shows an error, creating nothing, when the token ended with the form open, and reconnects on request", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.createStatus = 401;
    fakes.endpoints.createBody = { error: "token_expired" };
    const { navigate } = await show(fakes);
    await click("Add appointment");
    fireEvent.change(screen.getByLabelText("Appointment title"), {
      target: { value: "Quote" },
    });

    await click("Save");

    expect(screen.getByText(tokenEndedMessage)).toBeTruthy();
    expect(screen.getByRole("group", { name: "New appointment" })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    await click("Reconnect");

    expect(fakes.posts().at(-1)?.body).toMatchObject({ openForm: true });
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/grant");
  });

  it("says the appointment could not be saved when Google fails, and keeps the form", async () => {
    const fakes = fakeEndpoints();
    fakes.endpoints.createStatus = 503;
    fakes.endpoints.createBody = { error: "unavailable" };
    await show(fakes);
    await click("Add appointment");
    fireEvent.change(screen.getByLabelText("Appointment title"), {
      target: { value: "Quote" },
    });

    await click("Save");

    expect(
      screen.getByText("The appointment could not be saved. Please try again."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Appointment title")).toHaveProperty(
      "value",
      "Quote",
    );
  });

  it("opens the form at once after Google returns the browser with a good token", async () => {
    const fakes = fakeEndpoints();
    await show(fakes, { shouldOpenForm: () => true });

    expect(screen.getByRole("group", { name: "New appointment" })).toBeTruthy();
  });

  it("closes the form on Esc without closing anything else", async () => {
    const fakes = fakeEndpoints();
    await show(fakes);
    await click("Add appointment");
    const outer = vi.fn();
    document.addEventListener("keydown", outer);

    await waitFor(() =>
      fireEvent.keyDown(screen.getByLabelText("Appointment title"), {
        key: "Escape",
      }),
    );
    document.removeEventListener("keydown", outer);

    expect(screen.queryByRole("group", { name: "New appointment" })).toBeNull();
  });
});
