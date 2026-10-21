import { useId, useState, type ReactNode } from "react";
import { HEADER_COPY } from "./copy.js";
import { useDisclosure } from "./disclosure.js";

/**
 * The header's Menu: a disclosure (menu.ts has its rules, disclosure.ts
 * wires them to events). The panel comes straight after the button in the
 * page, so Tab goes from the button into it, and opening it does not move
 * focus. The panel's controls take effect at once and leave it open.
 */
export function HeaderMenu({
  children,
  defaultOpen = false,
}: {
  readonly children: ReactNode;
  /** For tests of the open markup. */
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${useId()}-panel`;
  const { wrapper, button, toggle, onBlur } = useDisclosure(open, setOpen);

  return (
    <div ref={wrapper} className="menu" onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label={HEADER_COPY.menu}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="menu-button-label" aria-hidden="true">
          {HEADER_COPY.menu}
        </span>
        <svg
          className="menu-icon menu-icon--chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <svg
          className="menu-icon menu-icon--bars"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div id={panelId} className="menu-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
