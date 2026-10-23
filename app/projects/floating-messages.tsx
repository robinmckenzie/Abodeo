// Messages that float over the page for a few seconds and fade (AD #54 Change
// UX While Dropped Images Are Added): why a drop is refused, why an image was
// not added, and other image problems. They stack at the bottom centre, newest
// at the bottom, in the top layer so that they show above an open project's
// window.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// How long a message shows before it starts to fade, and how long it takes to
// fade. Provisional: Robin may tune them.
export const messageDuration = 5000;
export const messageFadeDuration = 600;

// How many ordinary boxes show at once. Beyond that, one box says so.
export const maxMessageBoxes = 10;
export const furtherMessagesSuppressedMessage =
  "Further messages have been suppressed.";

export type MessageBox = {
  id: number;
  text: string;
  isFading: boolean;
  isSuppression: boolean;
};

// The boxes with a message added at the bottom. At the limit the message is
// dropped, and a box says so once, however many follow. Boxes that are
// fading still count, as they are still showing. The suppression box is not
// one of the ten.
export function addFloatingMessage(
  boxes: MessageBox[],
  text: string,
  id: number,
): MessageBox[] {
  const ordinary = boxes.filter(({ isSuppression }) => !isSuppression);
  if (ordinary.length < maxMessageBoxes) {
    return [...boxes, { id, text, isFading: false, isSuppression: false }];
  }
  if (boxes.some(({ isSuppression }) => isSuppression)) return boxes;
  return [
    ...boxes,
    {
      id,
      text: furtherMessagesSuppressedMessage,
      isFading: false,
      isSuppression: true,
    },
  ];
}

export function useFloatingMessages() {
  const [boxes, setBoxes] = useState<MessageBox[]>([]);
  const boxesRef = useRef<MessageBox[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const change = useCallback((next: MessageBox[]) => {
    boxesRef.current = next;
    setBoxes(next);
  }, []);

  const later = useCallback((action: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      action();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const showMessage = useCallback(
    (text: string) => {
      const id = nextIdRef.current++;
      const next = addFloatingMessage(boxesRef.current, text, id);
      if (next === boxesRef.current) return;
      change(next);
      later(() => {
        change(
          boxesRef.current.map((box) =>
            box.id === id ? { ...box, isFading: true } : box,
          ),
        );
        later(() => {
          change(boxesRef.current.filter((box) => box.id !== id));
        }, messageFadeDuration);
      }, messageDuration);
    },
    [change, later],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return { boxes, showMessage };
}

// Shows the stack again, on top of a modal dialog opened since. The timers
// are in React state, not in the popover, so they do not restart.
export function raiseFloatingMessages() {
  const stack = document.querySelector<HTMLElement>(".floating-messages");
  if (!stack) return;
  try {
    if (!stack.matches(":popover-open")) return;
    stack.hidePopover();
    stack.showPopover();
  } catch {
    // A browser without popovers has nothing to raise.
  }
}

export function FloatingMessages({ boxes }: { boxes: MessageBox[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const newestId = boxes.at(-1)?.id ?? null;
  const count = boxes.length;
  useLayoutEffect(() => {
    const stack = ref.current;
    if (!stack) return;
    try {
      stack.hidePopover();
      if (count > 0) stack.showPopover();
    } catch {
      // A browser without popovers shows the stack where it is.
    }
    // A new box raises the stack above a dialog opened since.
  }, [newestId, count]);
  return (
    <div ref={ref} className="floating-messages" popover="manual" role="status">
      {boxes.map((box) => (
        <p
          key={box.id}
          className={
            box.isFading ? "floating-message is-fading" : "floating-message"
          }
        >
          {box.text}
        </p>
      ))}
    </div>
  );
}
