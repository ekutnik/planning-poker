/**
 * The header's Menu is a disclosure, not an ARIA menu or a dialog: a button
 * that shows a small panel of mixed controls (docs/design.md, Header).
 * These are its rules, as a pure function so they can be tested without a
 * browser; HeaderMenu wires them to events. Toggling Facilitate or changing
 * the theme sends no event at all: they happen inside the menu, so the panel
 * stays open and the result can be seen.
 */
export type MenuEvent =
  /** The Menu button was pressed. */
  | "toggle"
  /** Escape, with focus in the button or the panel. */
  | "escape"
  /** A pointer went down outside the button and the panel. */
  | "click-outside"
  /** Focus moved to something outside the button and the panel. */
  | "focus-left";

export interface MenuState {
  readonly open: boolean;
  /** Put focus back on the Menu button. */
  readonly focusButton: boolean;
}

export function menuTransition(open: boolean, event: MenuEvent): MenuState {
  switch (event) {
    case "toggle":
      // Opening does not move focus: the next Tab goes into the panel,
      // which follows the button in the page.
      return { open: !open, focusButton: false };
    case "escape":
      // Focus would otherwise be left inside a hidden panel.
      return { open: false, focusButton: open };
    case "click-outside":
    case "focus-left":
      return { open: false, focusButton: false };
  }
}
