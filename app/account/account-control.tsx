// The account area below the dashboard's logo: who is signed in, the
// preferred name, what is kept, and signing in and out. It is plain text with
// no picture, so that it cannot be mistaken for an assignee or a project.
import { useId, useState } from "react";

import { normalisePreferredName, preferredNameMaxLength } from "./account-api";
import { chooseDisplayName } from "./account-display";
import {
  useAccount,
  type Account,
  type AccountView,
  type ProfileSaveResult,
} from "./use-account";

const saveMessages: Record<ProfileSaveResult, string> = {
  saved: "Saved.",
  invalid: `Enter 1 to ${preferredNameMaxLength} characters.`,
  unavailable: "Your preferred name could not be saved. Please try again later.",
  "signed-out": "You have been signed out.",
};

type SignedIn = Extract<AccountView, { kind: "signed-in" }>;

export function AccountControl({
  onBeforeLeave,
}: {
  onBeforeLeave: () => Promise<boolean>;
}) {
  const account = useAccount({ onBeforeLeave });
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const { view, message } = account;

  return (
    <div className="account">
      {view.kind === "unavailable" && (
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
      {view.kind === "signed-in" && isOpen && view.profile !== "loading" && (
        <AccountPanel
          account={account}
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
  view,
  panelId,
  onClose,
}: {
  account: Account;
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
      <h2>What Abodeo keeps about you</h2>
      <ul>
        <li>The permanent ID that Google gives your account.</li>
        <li>
          Your name and email address as Google gave them when you first
          signed in: {view.name}, {view.email}.
        </li>
        <li>Your preferred name, if you set one.</li>
        <li>
          A sign-in record for each browser you use, which ends when you sign
          out.
        </li>
      </ul>
      <p className="account-hint">
        Your projects stay in this browser and are not linked to your account.{" "}
        <a href="/privacy.html">Privacy</a>
      </p>
      <button
        type="button"
        className="account-sign-out"
        disabled={account.isLeaving}
        onClick={account.signOut}
      >
        Sign out
      </button>
    </section>
  );
}
