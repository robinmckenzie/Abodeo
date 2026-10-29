// The email to Robin about a visit (AD #94 Log Visits Before Sign-In), sent
// through Resend with a plain fetch. The settings come from the environment
// and are never logged: with no key or address, no email is sent.
type Environment = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type VisitAlertSettings = {
  apiKey: string;
  to: string;
  from: string;
  // Lower case labels that never send an email, such as Robin's own.
  ignoredLabels: string[];
  // No second email for a label within this many minutes.
  cooldownMinutes: number;
  // No more than this many emails in any hour, however many labels are sent,
  // because anyone can send a visit.
  hourlyLimit: number;
};

export type VisitAlert = {
  label: string;
  welcome: boolean;
  country: string;
  city: string;
  visitedAt: Date;
};

// Resend's test sender can send only to the Resend account's own address.
const defaultSender = "onboarding@resend.dev";

export const visitAlertTimeout = 3000;

// The cooldown when VISIT_ALERT_COOLDOWN_MINUTES is not set: none, because
// every visit matters to Robin.
export const defaultCooldownMinutes = 0;

// The hourly limit when VISIT_ALERT_HOURLY_LIMIT is not set.
export const defaultHourlyLimit = 20;

function read(env: Environment, name: string) {
  return env[name]?.trim() || undefined;
}

// A whole number, 0 or more. Anything else uses the default.
function readCount(env: Environment, name: string, fallback: number) {
  const text = read(env, name);
  return text !== undefined && /^\d{1,5}$/.test(text) ? Number(text) : fallback;
}

export function readVisitAlertSettings(
  env: Environment,
): VisitAlertSettings | undefined {
  const apiKey = read(env, "RESEND_API_KEY");
  const to = read(env, "VISIT_ALERT_TO");
  if (!apiKey || !to) return undefined;
  return {
    apiKey,
    to,
    from: read(env, "VISIT_ALERT_FROM") ?? defaultSender,
    ignoredLabels: (read(env, "VISIT_ALERT_IGNORE_LABELS") ?? "")
      .split(",")
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label !== ""),
    cooldownMinutes: readCount(
      env,
      "VISIT_ALERT_COOLDOWN_MINUTES",
      defaultCooldownMinutes,
    ),
    hourlyLimit: readCount(env, "VISIT_ALERT_HOURLY_LIMIT", defaultHourlyLimit),
  };
}

export function formatVisitAlert(alert: VisitAlert) {
  const who = alert.label || "unknown visitor (no label)";
  const place = [alert.city, alert.country].filter(Boolean).join(", ");
  return {
    subject: `Abodeo visit: ${alert.label || "Unknown visitor"}`,
    text: [
      "Someone opened Abodeo.",
      `Label: ${who}`,
      `Welcome screen requested: ${alert.welcome ? "yes" : "no"}`,
      `Place: ${place || "unknown"}`,
      `Time (UTC): ${alert.visitedAt.toISOString()}`,
    ].join("\n"),
  };
}

export async function sendVisitAlert(
  settings: VisitAlertSettings,
  alert: VisitAlert,
  fetchFn: Fetch = fetch,
  timeout = visitAlertTimeout,
) {
  const { subject, text } = formatVisitAlert(alert);
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: settings.from,
      to: [settings.to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`visit_alert_${response.status}`);
}
