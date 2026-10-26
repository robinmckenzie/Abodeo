// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  alertHourlyLimit,
  createVisitStore,
  handleSiteVisitRequest,
  isAlertCandidate,
  readVisitPlace,
  type Visit,
  type VisitStore,
} from "./site-visit.server";
import type { VisitAlertSettings } from "./visit-alert.server";

const settings: VisitAlertSettings = {
  apiKey: "key",
  to: "robin@example.com",
  from: "onboarding@resend.dev",
  ignoredLabels: ["robin"],
  cooldownMinutes: 360,
};

const human: Visit = {
  label: "",
  welcome: true,
  isBot: false,
  country: "",
  city: "",
};

function createFakeDatabase(isAllowed = true) {
  const query = vi.fn<
    (
      text: string,
      values: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>
  >(async (text) =>
    text.startsWith("select\n") ? { rows: [{ ok: isAllowed }] } : { rows: [] },
  );
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { database: { query, connect }, query, release };
}

function postVisit(headers: Record<string, string> = {}, body = "{}") {
  return new Request("http://localhost:5173/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function createFakeStore(shouldEmail = false) {
  return {
    recordVisit: vi.fn<VisitStore["recordVisit"]>(async () => shouldEmail),
  };
}

describe("isAlertCandidate", () => {
  it("accepts the welcome link with no label", () => {
    expect(isAlertCandidate(human, [])).toBe(true);
  });

  it("rejects a visit with no label and no ?welcome", () => {
    expect(isAlertCandidate({ ...human, welcome: false }, [])).toBe(false);
  });

  it("accepts a label, with or without ?welcome", () => {
    expect(isAlertCandidate({ ...human, label: "Andrew" }, [])).toBe(true);
    expect(
      isAlertCandidate({ ...human, label: "Andrew", welcome: false }, []),
    ).toBe(true);
  });

  it("rejects an ignored label in any case", () => {
    expect(isAlertCandidate({ ...human, label: "Robin" }, ["robin"])).toBe(
      false,
    );
  });

  it("rejects a bot", () => {
    expect(isAlertCandidate({ ...human, isBot: true }, [])).toBe(false);
  });
});

describe("readVisitPlace", () => {
  it("reads Vercel's country and decoded city", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "GB",
      "x-vercel-ip-city": "Z%C3%BCrich",
    });
    expect(readVisitPlace(headers)).toEqual({
      country: "GB",
      city: "Zürich",
    });
  });

  it("gives empty text where a header is missing or cannot be decoded", () => {
    expect(readVisitPlace(new Headers())).toEqual({ country: "", city: "" });
    expect(
      readVisitPlace(new Headers({ "x-vercel-ip-city": "%E0%A4%A" })),
    ).toEqual({ country: "", city: "" });
  });

  it("caps long values", () => {
    const { city } = readVisitPlace(
      new Headers({ "x-vercel-ip-city": "a".repeat(500) }),
    );
    expect(city).toHaveLength(100);
  });
});

describe("createVisitStore", () => {
  it("adds the visit and says to email when the cooldown and limit allow", async () => {
    const { database, query, release } = createFakeDatabase(true);
    const emailed = await createVisitStore(database).recordVisit(
      human,
      true,
      4,
    );

    expect(emailed).toBe(true);
    const texts = query.mock.calls.map(([text]) => text);
    expect(texts[0]).toBe("begin");
    expect(texts[1]).toContain("pg_advisory_xact_lock");
    expect(texts[2]).toContain("site_visit");
    expect(query.mock.calls[2][1]).toEqual(["", 4, alertHourlyLimit]);
    expect(texts[3]).toContain("insert into site_visit");
    expect(query.mock.calls[3][1]).toEqual(["", true, false, "", "", true]);
    expect(texts[4]).toBe("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("adds the visit without email inside the cooldown or over the limit", async () => {
    const { database, query } = createFakeDatabase(false);
    const emailed = await createVisitStore(database).recordVisit(
      human,
      true,
      4,
    );

    expect(emailed).toBe(false);
    expect(query.mock.calls[3][1]).toEqual(["", true, false, "", "", false]);
  });

  it("does not check the cooldown when email is not wanted", async () => {
    const { database, query } = createFakeDatabase(true);
    const emailed = await createVisitStore(database).recordVisit(
      human,
      false,
      4,
    );

    expect(emailed).toBe(false);
    expect(query.mock.calls.map(([text]) => text)).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1))",
      expect.stringContaining("insert into site_visit"),
      "commit",
    ]);
  });

  it("rolls back and releases when a query fails", async () => {
    const { database, query, release } = createFakeDatabase();
    query.mockImplementation(async (text) => {
      if (text.startsWith("insert")) throw new Error("boom");
      return { rows: [] };
    });

    await expect(
      createVisitStore(database).recordVisit(human, false, 4),
    ).rejects.toThrow("boom");
    expect(query).toHaveBeenLastCalledWith("rollback", []);
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("handleSiteVisitRequest", () => {
  it("records a visit with the label, the welcome flag and the place", async () => {
    const store = createFakeStore();
    const response = await handleSiteVisitRequest(
      postVisit(
        {
          Cookie: "abodeo_label=Andrew",
          "x-vercel-ip-country": "GB",
          "x-vercel-ip-city": "Leeds",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
        },
        '{"welcome":true}',
      ),
      { store, alerts: settings },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(store.recordVisit).toHaveBeenCalledWith(
      {
        label: "Andrew",
        welcome: true,
        isBot: false,
        country: "GB",
        city: "Leeds",
      },
      true,
      360,
    );
  });

  it("flags a bot user agent and does not ask for an email", async () => {
    const store = createFakeStore();
    await handleSiteVisitRequest(
      postVisit({
        "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
      }),
      { store, alerts: settings },
    );

    expect(store.recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ isBot: true }),
      false,
      360,
    );
  });

  it("treats anything but welcome:true as no welcome", async () => {
    const store = createFakeStore();
    for (const body of ['{"welcome":"yes"}', "not json", "[]", "{}"]) {
      await handleSiteVisitRequest(postVisit({}, body), {
        store,
        alerts: settings,
      });
    }

    expect(
      store.recordVisit.mock.calls.map(([visit]) => visit.welcome),
    ).toEqual([false, false, false, false]);
  });

  it("records without email when no email settings are configured", async () => {
    const store = createFakeStore();
    await handleSiteVisitRequest(postVisit({}, '{"welcome":true}'), {
      store,
      alerts: undefined,
    });

    expect(store.recordVisit).toHaveBeenCalledWith(
      expect.anything(),
      false,
      360,
    );
  });

  it("sends the email when the store says to", async () => {
    const store = createFakeStore(true);
    const sendAlert = vi.fn(async () => {});
    const response = await handleSiteVisitRequest(
      postVisit({ Cookie: "abodeo_label=Andrew" }),
      { store, alerts: settings, sendAlert },
    );

    expect(response.status).toBe(204);
    expect(sendAlert).toHaveBeenCalledWith(
      settings,
      expect.objectContaining({ label: "Andrew", visitedAt: expect.any(Date) }),
    );
  });

  it("does not send an email when the store says not to", async () => {
    const sendAlert = vi.fn(async () => {});
    await handleSiteVisitRequest(postVisit(), {
      store: createFakeStore(false),
      alerts: settings,
      sendAlert,
    });

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("still answers 204 when the email fails, reporting only a code", async () => {
    const reportFailure = vi.fn();
    const response = await handleSiteVisitRequest(
      postVisit({ Cookie: "abodeo_label=Andrew" }),
      {
        store: createFakeStore(true),
        alerts: settings,
        sendAlert: async () => {
          throw new Error("visit_alert_500");
        },
        reportFailure,
      },
    );

    expect(response.status).toBe(204);
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain("key");
  });

  it("answers 503 when the visit cannot be recorded", async () => {
    const reportFailure = vi.fn();
    const response = await handleSiteVisitRequest(postVisit(), {
      store: {
        recordVisit: async () => {
          throw new Error("down");
        },
      },
      alerts: settings,
      reportFailure,
    });

    expect(response.status).toBe(503);
    expect(reportFailure).toHaveBeenCalledOnce();
  });

  it("answers 503 when the store is too slow", async () => {
    const response = await handleSiteVisitRequest(postVisit(), {
      store: { recordVisit: () => new Promise(() => {}) },
      alerts: settings,
      timeout: 10,
      reportFailure: () => {},
    });

    expect(response.status).toBe(503);
  });

  it("refuses other methods and non-JSON bodies", async () => {
    const store = createFakeStore();
    const get = await handleSiteVisitRequest(
      new Request("http://localhost:5173/api/visit"),
      { store, alerts: settings },
    );
    const form = await handleSiteVisitRequest(
      postVisit({ "Content-Type": "text/plain" }),
      { store, alerts: settings },
    );

    expect(get.status).toBe(405);
    expect(form.status).toBe(400);
    expect(store.recordVisit).not.toHaveBeenCalled();
  });
});
