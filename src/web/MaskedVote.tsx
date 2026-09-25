import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Card } from "../shared/deck.js";
import { freshAnnouncement } from "./announce.js";
import { maskedInputType, submitMasked } from "./masked.js";

// Checked once, when the module loads: support cannot change while the page
// is open.
const css = (globalThis as { CSS?: typeof CSS }).CSS;
const INPUT_TYPE = maskedInputType(
  css === undefined
    ? undefined
    : (property, value) => css.supports(property, value),
);

/**
 * The leak-free way to vote on a shared screen, where the cursor moving to a
 * card would show the vote. Typing is masked, the field always clears, and
 * no message ever contains what was typed. Not a <form>, and marked so
 * password managers leave it alone. Nothing here shows the vote itself.
 */
export function MaskedVote({
  disabled,
  hasVoted,
  onVote,
  onClear,
}: {
  readonly disabled: boolean;
  readonly hasVoted: boolean;
  readonly onVote: (card: Card) => void;
  readonly onClear: () => void;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const { vote, message: next } = submitMasked(value);
    setValue("");
    // A second "Vote recorded" must still be spoken.
    setMessage((previous) => freshAnnouncement(previous, next));
    if (vote !== null) onVote(vote);
  };

  // The button unmounts once the vote is gone, so focus goes back to the
  // field; and "Vote recorded" would now contradict the screen.
  const clear = () => {
    setMessage(null);
    input.current?.focus();
    onClear();
  };

  return (
    <div className="own-vote">
      <label htmlFor={id}>Your vote (hidden)</label>
      <input
        ref={input}
        id={id}
        className="masked"
        type={INPUT_TYPE}
        value={value}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        data-form-type="other"
        aria-describedby={`${id}-message`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p id={`${id}-message`} role="status" className="own-vote-message">
        {message}
      </p>
      {hasVoted && (
        <>
          <p className="own-vote-confirmation">You&apos;ve voted ✓</p>
          <button type="button" disabled={disabled} onClick={clear}>
            Clear my vote
          </button>
        </>
      )}
    </div>
  );
}
