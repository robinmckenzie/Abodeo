// The Bin (AD #62 Delete Projects): the account's deleted projects, which can
// be restored until the dashboard next clears those past the cooling-off
// period, or deleted for good at once. Loading this page never clears
// anything, so a project past the period stays here, and can be restored,
// until the dashboard does.
import { useEffect, useRef, useState } from "react";

import type { Route } from "./+types/bin";
import {
  deleteAccountProjectPermanently,
  loadAccountBin,
  restoreAccountProject,
  type AccountFailure,
  type BinnedProject,
} from "../projects/account-projects";
import {
  describeBinTimeLeft,
  isPastBinPeriod,
} from "../projects/delete-project";
import { useRefreshBinCount, useScreenAccount } from "../screen-context";
import { ScreenPanel } from "../screen-panel";
import { DeleteProjectDialog } from "../projects/delete-project-dialog";
import {
  FloatingMessages,
  useFloatingMessages,
} from "../ui/floating-messages";
import { BinIcon, BinScreenIcon } from "../ui/icons";

export const meta: Route.MetaFunction = () => [
  { title: "Bin - Abodeo" },
  { name: "description", content: "Deleted projects." },
];

type BinState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      projects: BinnedProject[];
      unreadableCount: number;
      imageCounts: Record<string, number>;
    };

// How often the time left is worked out again while the page is open.
const clockInterval = 60 * 1000;

const failureMessage = "Not deleted: Abodeo could not delete this project.";

export default function Bin() {
  // Nothing on this screen is left unsaved, so it registers nothing to do
  // before leaving.
  const account = useScreenAccount();
  const refreshBinCount = useRefreshBinCount();
  const accountId = account.view.kind === "signed-in" ? account.view.id : null;
  const [loaded, setLoaded] = useState<{
    accountId: string;
    state: BinState;
  } | null>(null);
  const state: BinState =
    accountId && loaded?.accountId === accountId
      ? loaded.state
      : { status: "loading" };
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    project: BinnedProject;
    isBusy: boolean;
    message: string | null;
  } | null>(null);
  const { boxes: messageBoxes, showMessage } = useFloatingMessages();
  const recheckRef = useRef(account.recheck);
  useEffect(() => {
    recheckRef.current = account.recheck;
  });

  // Only the Bin's own list is read, never the dashboard's, which would clear
  // the projects past the cooling-off period. Changing reloadCount reads it
  // again.
  const [reloadCount, setReloadCount] = useState(0);
  const reload = () => {
    setReloadCount((count) => count + 1);
    refreshBinCount();
  };
  useEffect(() => {
    if (!accountId) return;
    let isCurrent = true;
    void loadAccountBin(accountId).then((result) => {
      if (!isCurrent) return;
      setNow(Date.now());
      if (!result.ok) {
        noteFailure(result.reason, recheckRef.current);
        setLoaded({ accountId, state: { status: "unavailable" } });
        return;
      }
      setLoaded({
        accountId,
        state: {
          status: "ready",
          projects: result.projects,
          unreadableCount: result.unreadableCount,
          imageCounts: result.imageCounts,
        },
      });
    });
    return () => {
      isCurrent = false;
    };
  }, [accountId, reloadCount]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), clockInterval);
    return () => clearInterval(timer);
  }, []);

  const restore = async ({ project }: BinnedProject) => {
    if (!accountId || busyId) return;
    setBusyId(project.id);
    const result = await restoreAccountProject(accountId, project.id);
    setBusyId(null);
    if (result.ok) {
      showMessage(`“${project.title}” was restored.`);
    } else {
      noteFailure(result.reason, account.recheck);
      showMessage(
        result.reason === "not-found"
          ? `“${project.title}” is no longer in the Bin.`
          : "Not restored: Abodeo could not restore this project.",
        true,
      );
    }
    reload();
  };

  const confirmDeletePermanently = async () => {
    if (!accountId || !deleting || deleting.isBusy) return;
    const { project } = deleting.project;
    setDeleting({ ...deleting, isBusy: true, message: null });
    const result = await deleteAccountProjectPermanently(accountId, project.id);
    if (!result.ok) {
      noteFailure(result.reason, account.recheck);
      setDeleting((current) =>
        current ? { ...current, isBusy: false, message: failureMessage } : null,
      );
      return;
    }
    setDeleting(null);
    showMessage(`“${project.title}” was deleted permanently.`);
    reload();
  };

  return (
    <>
      <ScreenPanel title="Bin" icon={<BinScreenIcon />} className="bin-page">
        {account.view.kind === "checking" && <p role="status">Loading…</p>}
        {(account.view.kind === "signed-out" ||
          account.view.kind === "not-configured") && (
          <p className="people-hint">
            Sign in to use the Bin. Projects deleted while signed out are
            removed for good.
          </p>
        )}
        {account.view.kind === "unavailable" && (
          <p className="dashboard-notice" role="alert">
            Your Bin cannot be loaded right now. Please try again later.
          </p>
        )}
        {accountId && state.status === "loading" && (
          <p role="status">Loading…</p>
        )}
        {accountId && state.status === "unavailable" && (
          <p className="dashboard-notice" role="alert">
            Your Bin cannot be loaded right now. Please try again later.
          </p>
        )}
        {state.status === "ready" && (
          <>
            {state.unreadableCount > 0 && (
              <p className="dashboard-notice" role="alert">
                {state.unreadableCount === 1
                  ? "1 deleted project cannot be read, so it is not shown. It has been left as it is."
                  : `${state.unreadableCount} deleted projects cannot be read, so they are not shown. They have been left as they are.`}
              </p>
            )}
            {state.projects.length === 0 ? (
              <p className="dashboard-empty">The Bin is empty.</p>
            ) : (
              <ul className="bin-list" aria-label="Deleted projects">
                {state.projects.map((binned) => {
                  const { project, deletedAt } = binned;
                  const isPast = isPastBinPeriod(deletedAt, now);
                  return (
                    <li key={project.id} className="bin-row">
                      <div className="bin-details">
                        <span className="bin-title">{project.title}</span>
                        <span
                          className={isPast ? "bin-time is-past" : "bin-time"}
                        >
                          {describeBinTimeLeft(deletedAt, now)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="button-main"
                        disabled={busyId !== null}
                        onClick={() => void restore(binned)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="button-delete bin-delete"
                        disabled={busyId !== null}
                        onClick={() =>
                          setDeleting({
                            project: binned,
                            isBusy: false,
                            message: null,
                          })
                        }
                      >
                        <BinIcon />
                        Delete permanently
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </ScreenPanel>
      {deleting && state.status === "ready" && (
        <DeleteProjectDialog
          project={deleting.project.project}
          imageCount={state.imageCounts[deleting.project.project.id] ?? 0}
          appointmentCount={null}
          mode="permanent"
          isBusy={deleting.isBusy}
          message={deleting.message}
          onConfirm={() => void confirmDeletePermanently()}
          onCancel={() => setDeleting(null)}
        />
      )}
      <FloatingMessages boxes={messageBoxes} />
    </>
  );
}

// A failure that means the sign-in has changed checks it again.
function noteFailure(reason: AccountFailure, recheck: () => void) {
  if (reason === "signed-out" || reason === "account-changed") recheck();
}
