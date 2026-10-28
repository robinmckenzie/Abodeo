// The right-hand side of every screen (AD #99 Layout and Style Tidy): the
// title row, which stays in view while the content scrolls, and the content
// below it. The title row holds the screen's actions, such as Add project.
export function ScreenPanel({
  title,
  actions,
  className,
  ref,
  tabIndex,
  isTitleInert = false,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLElement>;
  tabIndex?: number;
  isTitleInert?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <main
      className={className ? `screen-panel ${className}` : "screen-panel"}
      ref={ref}
      tabIndex={tabIndex}
    >
      <div className="screen-title" inert={isTitleInert}>
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </main>
  );
}
