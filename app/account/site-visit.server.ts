// Visits to the app before anyone signs in (AD #94 Log Visits Before Sign-In),
// in the site_visit table of db/account-tables.sql. The page reports each one
// from the browser, because the usage label's cookie is sent only to /api.
// Kept: the server's time, the label, whether the address had ?welcome,
// whether the user agent looks like a bot, and the country and city the host
// gives. Never the IP address or the user agent itself.
import { isbot } from "isbot";

import type { HistoryDatabase } from "./account-history.server";
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  withTimeout,
} from "./account-profile.server";
import { readLabel } from "./usage-label.server";
import { sendVisitAlert, type VisitAlertSettings } from "./visit-alert.server";

// No second email for a label within this long. A provisional default.
export const alertCooldownHours = 6;

// No more than this many emails in any hour, however many labels are sent,
// because anyone can send a visit.
export const alertHourlyLimit = 5;

export type Visit = {
  label: string;
  welcome: boolean;
  isBot: boolean;
  country: string;
  city: string;
};

export type VisitStore = {
  // Adds the visit, and says whether it is the one to email about: only when
  // canEmail, and neither the label's cooldown nor the hourly limit applies.
  recordVisit(visit: Visit, canEmail: boolean): Promise<boolean>;
};

export type VisitDependencies = {
  store: VisitStore;
  alerts: VisitAlertSettings | undefined;
};

// A visit is worth an email when it is not a bot's and it either has a label
// that is not ignored or asks for the welcome screen with no label, which is
// the link Robin gave out.
export function isAlertCandidate(
  visit: Visit,
  ignoredLabels: string[],
): boolean {
  if (visit.isBot) return false;
  if (visit.label === "") return visit.welcome;
  return !ignoredLabels.includes(visit.label.toLowerCase());
}

const maxPlaceLength = 100;

// The country and city that Vercel works out from the address. Empty where the
// host does not give them, as on a development server.
export function readVisitPlace(headers: Headers) {
  const clean = (value: string | null) => {
    if (!value) return "";
    try {
      return decodeURIComponent(value).trim().slice(0, maxPlaceLength);
    } catch {
      return "";
    }
  };
  return {
    country: clean(headers.get("x-vercel-ip-country")),
    city: clean(headers.get("x-vercel-ip-city")),
  };
}

export function createVisitStore(database: HistoryDatabase): VisitStore {
  return {
    async recordVisit(visit, canEmail) {
      const client = await database.connect();
      try {
        await client.query("begin", []);
        // Visits take turns, so that two at once cannot both send an email.
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [
          "site_visit",
        ]);
        let shouldEmail = false;
        if (canEmail) {
          const { rows } = await client.query(
            `select
               not exists (
                 select 1 from site_visit
                 where emailed and label = $1
                   and visited_at > clock_timestamp() - make_interval(hours => $2)
               )
               and (
                 select count(*) from site_visit
                 where emailed and visited_at > clock_timestamp() - interval '1 hour'
               ) < $3 as ok`,
            [visit.label, alertCooldownHours, alertHourlyLimit],
          );
          shouldEmail = rows[0]?.ok === true;
        }
        await client.query(
          `insert into site_visit
             (visited_at, label, welcome, is_bot, country, city, emailed)
           values (clock_timestamp(), $1, $2, $3, $4, $5, $6)`,
          [
            visit.label,
            visit.welcome,
            visit.isBot,
            visit.country,
            visit.city,
            shouldEmail,
          ],
        );
        await client.query("commit", []);
        return shouldEmail;
      } catch (error) {
        await client.query("rollback", []).catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function reportVisitFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "site_visit_failed", code }));
}

const maxBodyLength = 1000;

// Only a body of {"welcome": true} counts as asking for the welcome screen.
async function readWelcome(request: Request): Promise<boolean> {
  try {
    const text = await request.text();
    if (text.length > maxBodyLength) return false;
    const body: unknown = JSON.parse(text);
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { welcome?: unknown }).welcome === true
    );
  } catch {
    return false;
  }
}

export type SiteVisitDependencies = VisitDependencies & {
  sendAlert?: typeof sendVisitAlert;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

// Handles POST of siteVisitPath. No sign-in is needed. A failed email loses
// the email, not the visit.
export async function handleSiteVisitRequest(
  request: Request,
  {
    store,
    alerts,
    sendAlert = sendVisitAlert,
    timeout = accountStoreTimeout,
    reportFailure = reportVisitFailure,
  }: SiteVisitDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return respondWithError(405, "method_not_allowed");
  }
  // A form on another site cannot send JSON, so it cannot add a visit.
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return respondWithError(400, "invalid_request");
  }
  const visit: Visit = {
    label: readLabel(request.headers),
    welcome: await readWelcome(request),
    isBot: isbot(request.headers.get("User-Agent") ?? ""),
    ...readVisitPlace(request.headers),
  };
  try {
    const canEmail =
      alerts !== undefined && isAlertCandidate(visit, alerts.ignoredLabels);
    const shouldEmail = await withTimeout(
      store.recordVisit(visit, canEmail),
      timeout,
    );
    if (shouldEmail && alerts) {
      await sendAlert(alerts, { ...visit, visitedAt: new Date() }).catch(
        (error: unknown) => reportFailure(readErrorCode(error)),
      );
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}
