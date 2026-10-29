// Every icon is drawn once, here, in a 20-unit square with the same thin
// circle around it (AD #99 Layout and Style Tidy), apart from the screens'. The size, line weight and
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
      <path d="M6.2 7.6h7.6M11.25 5.05l2.55 2.55-2.55 2.55M13.8 12.4H6.2M8.75 9.85L6.2 12.4l2.55 2.55" />
    </CircledIcon>
  );
}

// The icons of the three screens, in the menu and beside each screen's title.
// Not circled: they name a place, not an action. The line weight is set in
// app.css.
function ScreenIcon({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="4 4 12 12"
      aria-hidden="true"
      className="screen-icon"
      data-icon={name}
    >
      {children}
    </svg>
  );
}

export function ProjectsIcon() {
  return (
    <ScreenIcon name="projects">
      <path d="M5.5 7.5v6.5h9V8.8H10.2L9 7.5H5.5z" />
    </ScreenIcon>
  );
}

export function PeopleIcon() {
  return (
    <ScreenIcon name="people">
      <path d="M8.2 6.6a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 1 0 0-3.4M5 14c0-1.9 1.4-3 3.2-3s3.2 1.1 3.2 3M12.6 7.2a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8M12.8 11.2c1.4 0 2.4 1 2.4 2.8" />
    </ScreenIcon>
  );
}

// A bin with its lid ajar, to tell it from the bin of a delete button. One
// short line inside for each project in it, up to three, filling from the
// bottom. The three places are 1.9 units apart, the top one level with the top
// of the bin's body; the space left below the lowest is also 1.9, and the
// sides are clear.
export function BinScreenIcon({ count = 0 }: { count?: number }) {
  return (
    <ScreenIcon name="bin-screen">
      <path d="M5.5 7.4l8.4-1.7M8.6 6.9l-.1-1.3l2.6-.5M6.8 8.8l.4 5.7h5.6l.4-5.7" />
      {Array.from({ length: Math.min(count, 3) }, (_, index) => (
        <path key={index} d={`M8.8 ${12.6 - index * 1.9}h2.4`} />
      ))}
    </ScreenIcon>
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
