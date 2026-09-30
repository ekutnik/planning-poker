import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_TICKET_LENGTH } from "../shared/rules.js";
import { TICKET_COPY } from "./copy.js";

/**
 * The ticket being estimated, above the room: "Now estimating" and the text,
 * the same for everyone. A paragraph, not a heading: the status line stays
 * the page's h1, and a heading above it would break the order. Participants
 * see nothing at all while there is no ticket; the facilitator view adds
 * Edit (or Add a ticket), editing in place. React renders the text as text,
 * so markup in a ticket shows as typed.
 */
export function Ticket({
  ticket,
  facilitating,
  live,
  onSave,
}: {
  readonly ticket: string | null;
  readonly facilitating: boolean;
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

  // Editing belongs to the facilitator view; switching it off ends editing.
  if (editing && !facilitating) setEditing(false);

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
        <div className="ticket-edit-row">
          <input
            id={inputId}
            ref={input}
            className="text-field ticket-input"
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
          <button type="submit" disabled={!live}>
            {TICKET_COPY.save}
          </button>
          <button type="button" onClick={finish}>
            {TICKET_COPY.cancel}
          </button>
        </div>
      </form>
    );
  }

  if (ticket === null && !facilitating) return null;
  // One button, Add a ticket or Edit, in the same place either way: after
  // Save, focus is on it before the new ticket arrives, and it must still
  // be the same element when its label changes.
  return (
    <div className={ticket === null ? "ticket ticket--empty" : "ticket"}>
      {ticket !== null && (
        <div className="ticket-words">
          <p className="ticket-label">{TICKET_COPY.label}</p>
          <p className="ticket-text">{ticket}</p>
        </div>
      )}
      {facilitating && (
        <button
          type="button"
          ref={opener}
          className="ticket-button"
          onClick={() => setEditing(true)}
        >
          {ticket === null ? (
            TICKET_COPY.add
          ) : (
            <>
              {TICKET_COPY.edit}
              <span className="visually-hidden"> {TICKET_COPY.editTarget}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
