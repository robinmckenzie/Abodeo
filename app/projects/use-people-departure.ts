import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { setPageLeaving } from "./account-projects";
import type { PeopleDrafts } from "./people-drafts";

export function usePeopleDeparture(stores: Map<string, PeopleDrafts>) {
  const [departing, setDeparting] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const resume = useCallback(() => {
    stores.forEach(store => store.resume());
    setPageLeaving(false);
    setDeparting(false);
  }, [stores]);
  const leave = useCallback(() => {
    const relevant = [...stores.values()];
    if (relevant.length > 0 && relevant.every(store => store.approved())) return Promise.resolve(true);
    if (pending.current) return pending.current;
    setDeparting(true);
    relevant.forEach(store => store.beginDeparture());
    pending.current = (async () => {
      try {
        await Promise.all(relevant.map(store => store.flush()));
        if (relevant.some(store => store.unresolved()) && !window.confirm("Some People edits have not been saved. Leave and lose these edits? Choose Cancel to stay and correct or retry them.")) {
          resume();
          return false;
        }
        relevant.forEach(store => store.approveDeparture());
        return true;
      } catch { resume(); return false; }
      finally { pending.current = null; }
    })();
    return pending.current;
  }, [stores, resume]);
  const blocker = useBlocker(() => [...stores.values()].some(store => store.unresolved() && !store.approved()));
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let active = true;
    void leave().then(allowed => {
      if (active) { if (allowed) blocker.proceed(); else blocker.reset(); }
    });
    return () => { active = false; };
  }, [blocker, leave]);
  useEffect(() => {
    const registered = stores;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const unresolved = [...registered.values()].filter(store => store.unresolved() && !store.approved());
      if (unresolved.length === 0) return;
      setPageLeaving(true);
      unresolved.forEach(store => { void store.flush(); });
      event.preventDefault();
      event.returnValue = "";
      // After cancelling the native dialog this document resumes execution.
      setTimeout(() => setPageLeaving(false), 0);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pageshow", resume);
      registered.forEach(store => store.dispose());
      setPageLeaving(false);
    };
  }, [stores, resume]);
  return { leave, resume, departing };
}
