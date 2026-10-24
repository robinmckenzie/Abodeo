# Tech debt

Known shortcuts in the code that work today but should be cleaned up. Each
entry says what the shortcut is and what to do about it.

## Layout

- Each screen (the dashboard and People) draws its own left-hand column: the
  logo, the account area and the menu. Each screen also looks up the account
  for itself. A screen reached from within the app starts from the account the
  last screen found (`lastKnownView` in `app/account/use-account.ts`), which
  hides the gap but does not remove the second lookup. The Projects and People
  titles share the `dashboard-toolbar` class and a hand-set minimum height
  (2.6rem) that stands in for the height of Add project, and People borrows
  the dashboard's CSS classes. Added in AD #61 Manage People.
  Refactor into a shared layout route that owns the left-hand column and the
  account for every screen, with the page content as its outlet. The column
  and the account would then never reload when moving between screens, the
  toolbar and title would be one component, and the screen-specific
  `onBeforeLeave` would be registered with the layout instead of passed down.
