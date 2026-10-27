// The account area below the dashboard's logo: who is signed in, the
// preferred name, the Calendar test, what is kept, and signing in and out. It is plain text with
// no picture, so that it cannot be mistaken for an assignee or a project.
import { useEffect, useId, useRef, useState } from "react";

import {
  calendarMessages,
  buildGoogleCalendarAddress,
  useCalendarTest,
  type CalendarTest,
} from "../calendar/use-calendar-test";
import { normalisePreferredName, preferredNameMaxLength } from "./account-api";
import { chooseDisplayName } from "./account-display";
import { useActivityReport } from "./use-activity-report";
import type { Account, AccountView, ProfileSaveResult } from "./use-account";

const saveMessages: Record<ProfileSaveResult, string> = {
  saved: "Saved.",
  invalid: `Enter 1 to ${preferredNameMaxLength} characters.`,
  unavailable:
    "Your preferred name could not be saved. Please try again later.",
  "signed-out": "You have been signed out.",
};

type SignedIn = Extract<AccountView, { kind: "signed-in" }>;

// The account comes from the dashboard, whose projects depend on it.
export function AccountControl({
  account,
  onBeforeLeave,
  onLeaveFailed,
}: {
  account: Account;
  onBeforeLeave: () => Promise<boolean>;
  onLeaveFailed?: () => void;
}) {
  const calendar = useCalendarTest({ onBeforeLeave, onLeaveFailed });
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const { view, message } = account;
  useActivityReport(view.kind === "signed-in");

  // A press anywhere outside the account area closes the panel. The button
  // is inside it and toggles the panel itself.
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  return (
    <div className="account" ref={accountRef}>
      {(view.kind === "unavailable" || view.kind === "not-configured") && (
        <p className="account-unavailable">Sign-in is unavailable</p>
      )}
      {view.kind === "signed-out" && (
        <button
          type="button"
          className="account-button"
          disabled={account.isLeaving}
          onClick={account.signIn}
        >
          Sign in with Google
        </button>
      )}
      {view.kind === "signed-in" && (
        <button
          type="button"
          className="account-button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        >
          <span className="account-label">Signed in as</span>{" "}
          <span className="account-name">
            {chooseDisplayName(view.name, view.preferredName)}
          </span>
        </button>
      )}
      {message && (
        <p className="account-message" role="alert">
          {message}
        </p>
      )}
      {calendar.result && (
        <p
          className={`account-message calendar-message-${calendar.result}`}
          role={calendar.result === "created" ? "status" : "alert"}
        >
          {calendarMessages[calendar.result]}
          {/* The link waits for the account, so that it opens the right one. */}
          {calendar.result === "created" && view.kind === "signed-in" && (
            <>
              {" "}
              <a
                href={buildGoogleCalendarAddress(view.email)}
                target="_blank"
                rel="noreferrer"
              >
                Open Google Calendar
              </a>
            </>
          )}
        </p>
      )}
      {view.kind === "signed-in" && isOpen && view.profile !== "loading" && (
        <AccountPanel
          account={account}
          calendar={calendar}
          view={view}
          panelId={panelId}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

function AccountPanel({
  account,
  calendar,
  view,
  panelId,
  onClose,
}: {
  account: Account;
  calendar: CalendarTest;
  view: SignedIn;
  panelId: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(view.preferredName ?? "");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputId = useId();

  const save = async (value: string | null) => {
    if (value !== null && normalisePreferredName(value) === undefined) {
      setSaveMessage(saveMessages.invalid);
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    const result = await account.savePreferredName(
      value === null ? null : value.trim(),
    );
    setIsSaving(false);
    if (result === "saved") setDraft(value?.trim() ?? "");
    setSaveMessage(saveMessages[result]);
  };

  return (
    <section
      id={panelId}
      className="account-panel"
      aria-label="Your account"
      // Esc closes the panel, not a project open beside it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      {view.profile === "ready" ? (
        <form
          className="account-profile"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <label htmlFor={inputId}>Preferred name</label>
          <div className="account-profile-row">
            <input
              id={inputId}
              type="text"
              value={draft}
              maxLength={preferredNameMaxLength}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              disabled={isSaving}
            />
            <button type="submit" disabled={isSaving}>
              Save
            </button>
            {view.preferredName !== null && (
              <button
                type="button"
                onClick={() => void save(null)}
                disabled={isSaving}
              >
                Clear
              </button>
            )}
          </div>
          <p className="account-hint">
            Shown only to you, instead of your Google name.
          </p>
          <p className="account-save-message" role="status">
            {saveMessage}
          </p>
        </form>
      ) : (
        <p className="account-hint" role="status">
          Your preferred name is unavailable at the moment.
        </p>
      )}
      <h2>Google Calendar</h2>
      <p className="account-hint">
        Checks that Abodeo can add appointments to a separate Abodeo calendar in
        your Google account. Google asks for your permission first.
      </p>
      <button
        type="button"
        className="account-calendar-test"
        disabled={account.isLeaving || calendar.isLeaving}
        onClick={calendar.createTestAppointment}
      >
        Create test appointment
      </button>
      <h2>What Abodeo keeps about you</h2>
      <ul>
        <li>The permanent ID that Google gives your account.</li>
        <li>
          Your name and email address as Google gave them when you first signed
          in: {view.name}, {view.email}.
        </li>
        <li>Your preferred name, if you set one.</li>
        <li>
          The ID of your Abodeo calendar in Google Calendar, if one was made.
        </li>
        <li>A sign-in record for each browser you use.</li>
        <li>Your projects and their tasks.</li>
        <li>
          The images you add to your projects, exactly as you added them, with
          any location details inside the file, and your captions. Only you can
          see them.
        </li>
      </ul>
      <p className="account-hint">
        Projects you add while signed out stay in this browser.{" "}
        <a href="/privacy.html">Privacy</a>
      </p>
      <button
        type="button"
        className="account-sign-out"
        disabled={account.isLeaving || calendar.isLeaving}
        onClick={account.signOut}
      >
        Sign out
      </button>
    </section>
  );
}
