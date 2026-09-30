import { useId } from "react";

/**
 * A real switch (role="switch", aria-checked) with a visible label and a
 * one-line note that describes it. The label is a <label>, so a click on
 * the words toggles it too. In the DOM the words come first, then the
 * switch; `leading` draws the switch before the words, as the landing and
 * join forms do, with no second focus stop either way.
 */
export function SwitchRow({
  label,
  note,
  checked,
  onChange,
  leading = false,
  disabled = false,
}: {
  readonly label: string;
  readonly note: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly leading?: boolean;
  /** While a room reconnects, for a switch that changes the room. */
  readonly disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={leading ? "switch-row switch-row--leading" : "switch-row"}>
      <div className="switch-text">
        <label htmlFor={id} className="switch-label">
          {label}
        </label>
        <span id={`${id}-note`} className="switch-note">
          {note}
        </span>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-describedby={`${id}-note`}
        disabled={disabled || undefined}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}
