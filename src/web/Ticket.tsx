import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_TICKET_LENGTH } from "../shared/rules.js";
import { TICKET_COPY } from "./copy.js";

/**
 * The ticket slot, first in the action row: "Now estimating" and the ticket,
 * the same for everyone, on one line, cut short with "…" and whole in its
 * title and for a screen reader. A paragraph, not a heading: the status line
 * stays the page's h1, and a heading above it would break the order. React
 * renders the text as text, so markup in a ticket shows as typed.
 *
 * The slot is always in the page, empty when there is nothing to show: in
 * wide it is what holds the action row at its height, so nothing below it
 * moves when a ticket comes or goes (docs/design.md, The room's layout).
 * With `editable` (the facilitator view with Ticket name on), a pencil
 * (Edit the ticket) or Add a ticket, editing in place in the same row.
 */
export function Ticket({
  ticket,
  editable,
  live,
  onSave,
}: {
  readonly ticket: string | null;
  readonly editable: boolean;
  readonly live: boolean;
  readonly onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // Set when editing ends, so focus goes back to Edit (or Add a ticket)
  // once it is rendered again.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [editing]);

  // Editing belongs to the facilitator view with Ticket name on; switching
  // either off ends it.
  if (editing && !editable) setEditing(false);

  const finish = () => {
    returnFocus.current = true;
    setEditing(false);
  };

  if (editing) {
    const save = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSave(input.current?.value ?? "");
      finish();
    };
    return (
      <form className="ticket ticket--editing" onSubmit={save}>
        <label htmlFor={inputId} className="ticket-label">
          {TICKET_COPY.label}
        </label>
        <div className="ticket-row">
          <input
            id={inputId}
            ref={input}
            className="ticket-input"
            type="text"
            maxLength={MAX_TICKET_LENGTH}
            defaultValue={ticket ?? ""}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finish();
              }
            }}
          />
          <button
            type="submit"
            className="small-button primary"
            disabled={!live}
          >
            {TICKET_COPY.save}
          </button>
          <button type="button" className="small-button" onClick={finish}>
            {TICKET_COPY.cancel}
          </button>
        </div>
      </form>
    );
  }

  if (ticket === null && !editable) return <div className="ticket" />;
  // "Now estimating" over the ticket, or over Add a ticket while there is
  // none. One button, Add a ticket or Edit, second in the row either way:
  // after Save, focus is on it before the new ticket arrives, and it must
  // still be the same element when its label changes.
  return (
    <div className="ticket">
      <p className="ticket-label">{TICKET_COPY.label}</p>
      <div className="ticket-row">
        {ticket !== null && (
          <p className="ticket-text" title={ticket}>
            {ticket}
          </p>
        )}
        {editable && (
          <button
            type="button"
            ref={opener}
            className={
              ticket === null
                ? "small-button small-button--quiet"
                : "small-button small-button--quiet small-button--icon"
            }
            aria-label={ticket === null ? undefined : TICKET_COPY.edit}
            title={ticket === null ? undefined : TICKET_COPY.edit}
            onClick={() => setEditing(true)}
          >
            {ticket === null ? (
              <>
                <PlusIcon />
                {TICKET_COPY.add}
              </>
            ) : (
              <PencilIcon />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

const icon = {
  className: "small-button-icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function PencilIcon() {
  return (
    <svg {...icon}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...icon}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
