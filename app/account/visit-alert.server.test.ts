// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  formatVisitAlert,
  readVisitAlertSettings,
  sendVisitAlert,
  type VisitAlert,
  type VisitAlertSettings,
} from "./visit-alert.server";

const settings: VisitAlertSettings = {
  apiKey: "re_secret",
  to: "robin@example.com",
  from: "onboarding@resend.dev",
  ignoredLabels: [],
  cooldownMinutes: 360,
  hourlyLimit: 20,
};

const alert: VisitAlert = {
  label: "",
  welcome: true,
  country: "GB",
  city: "Leeds",
  visitedAt: new Date("2026-10-26T12:00:00Z"),
};

describe("readVisitAlertSettings", () => {
  it("is undefined without a key or an address", () => {
    expect(readVisitAlertSettings({})).toBeUndefined();
    expect(readVisitAlertSettings({ RESEND_API_KEY: "k" })).toBeUndefined();
    expect(
      readVisitAlertSettings({ VISIT_ALERT_TO: "robin@example.com" }),
    ).toBeUndefined();
  });

  it("uses Resend's test sender unless another is set", () => {
    const env = { RESEND_API_KEY: "k", VISIT_ALERT_TO: "robin@example.com" };
    expect(readVisitAlertSettings(env)?.from).toBe("onboarding@resend.dev");
    expect(
      readVisitAlertSettings({ ...env, VISIT_ALERT_FROM: "a@b.example" })?.from,
    ).toBe("a@b.example");
  });

  it("splits the ignored labels, lower case, without blanks", () => {
    expect(
      readVisitAlertSettings({
        RESEND_API_KEY: "k",
        VISIT_ALERT_TO: "robin@example.com",
        VISIT_ALERT_IGNORE_LABELS: " Robin, Test ,, ",
      })?.ignoredLabels,
    ).toEqual(["robin", "test"]);
  });
});

describe("readVisitAlertSettings cooldown", () => {
  const env = { RESEND_API_KEY: "k", VISIT_ALERT_TO: "robin@example.com" };

  it("is 360 minutes unless a whole number of minutes is set", () => {
    expect(readVisitAlertSettings(env)?.cooldownMinutes).toBe(360);
    for (const [text, hours] of [
      ["1", 1],
      ["0", 0],
    ] as const) {
      expect(
        readVisitAlertSettings({ ...env, VISIT_ALERT_COOLDOWN_MINUTES: text })
          ?.cooldownMinutes,
      ).toBe(hours);
    }
    for (const bad of ["soon", "-2", "1.5", ""]) {
      expect(
        readVisitAlertSettings({ ...env, VISIT_ALERT_COOLDOWN_MINUTES: bad })
          ?.cooldownMinutes,
      ).toBe(360);
    }
  });
});

describe("readVisitAlertSettings hourly limit", () => {
  const env = { RESEND_API_KEY: "k", VISIT_ALERT_TO: "robin@example.com" };

  it("is 20 unless a whole number is set", () => {
    expect(readVisitAlertSettings(env)?.hourlyLimit).toBe(20);
    expect(
      readVisitAlertSettings({ ...env, VISIT_ALERT_HOURLY_LIMIT: "3" })
        ?.hourlyLimit,
    ).toBe(3);
    for (const bad of ["many", "-1", "2.5", ""]) {
      expect(
        readVisitAlertSettings({ ...env, VISIT_ALERT_HOURLY_LIMIT: bad })
          ?.hourlyLimit,
      ).toBe(20);
    }
  });
});

describe("formatVisitAlert", () => {
  it("names the welcome link when there is no label", () => {
    const { subject, text } = formatVisitAlert(alert);
    expect(subject).toBe("Abodeo visit: welcome link");
    expect(text).toContain("no label (the welcome link)");
    expect(text).toContain("Place: Leeds, GB");
    expect(text).toContain("2026-10-26T12:00:00.000Z");
  });

  it("names the label and an unknown place", () => {
    const { subject, text } = formatVisitAlert({
      ...alert,
      label: "Andrew",
      country: "",
      city: "",
    });
    expect(subject).toBe("Abodeo visit: Andrew");
    expect(text).toContain("Place: unknown");
  });
});

describe("sendVisitAlert", () => {
  it("posts the email to Resend with the key as a bearer token", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendVisitAlert(settings, alert, fetchFn);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_secret",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "onboarding@resend.dev",
      to: ["robin@example.com"],
      subject: "Abodeo visit: welcome link",
    });
  });

  it("fails with a status code, never the key, when Resend refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 403 }));
    const failure = await sendVisitAlert(settings, alert, fetchFn).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("visit_alert_403");
  });
});
