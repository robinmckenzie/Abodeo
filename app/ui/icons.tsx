// Every icon is drawn once, here, in a 20-unit square with the same thin
// circle around it (AD #99 Layout and Style Tidy). The size, line weight and
// colour come from the shared values in app.css, so that icons of one kind
// look alike wherever they are used. The bin means remove, and the X means
// close.

function CircledIcon({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" data-icon={name}>
      <circle cx="10" cy="10" r="8.5" />
      {children}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <CircledIcon name="plus">
      <path d="M5.5 10h9M10 5.5v9" />
    </CircledIcon>
  );
}

export function BinIcon() {
  return (
    <CircledIcon name="bin">
      <path d="M5.97 6.87h8.05M8.21 6.87V5.53h3.58v1.34M6.87 6.87l.54 7.16h5.19l.54-7.16M8.84 9.1v3.13M11.16 9.1v3.13" />
    </CircledIcon>
  );
}

export function CloseIcon() {
  return (
    <CircledIcon name="close">
      <path d="M7 7l6 6M13 7l-6 6" />
    </CircledIcon>
  );
}

// The arrow is drawn pointing right and turned to face the way asked.
const arrowTurns = { right: 0, down: 90, left: 180, up: 270 };

export function ArrowIcon({
  direction,
}: {
  direction: keyof typeof arrowTurns;
}) {
  return (
    <CircledIcon name="arrow">
      <path
        d="M5.5 10h9M11 6.5l3.5 3.5M11 13.5l3.5-3.5"
        transform={`rotate(${arrowTurns[direction]} 10 10)`}
      />
    </CircledIcon>
  );
}

export function SwapIcon() {
  return (
    <CircledIcon name="swap">
      <path d="M4.9 6.6h10.2M12.55 4.05l2.55 2.55-2.55 2.55M15.1 13.4H4.9M7.45 10.85L4.9 13.4l2.55 2.55" />
    </CircledIcon>
  );
}

// The grip of a row that can be dragged. Not circled: it is a handle, not a
// button.
export function DragHandleIcon() {
  return (
    <svg viewBox="0 0 10 16" data-icon="drag-handle">
      {[3, 8, 13].flatMap((y) =>
        [3, 7].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.25" />
        )),
      )}
    </svg>
  );
}
