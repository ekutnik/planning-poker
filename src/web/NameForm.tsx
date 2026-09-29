import { useId, useState, type FormEvent, type ReactNode } from "react";
import { freshAnnouncement } from "./announce.js";
import { checkName } from "./view.js";

/**
 * A name field validated by the shared rule, so it accepts what the server
 * does. `children` sit between the field and the button: the Facilitate
 * switch on the landing and join forms.
 */
export function NameForm({
  initial,
  submitLabel,
  busy = false,
  onSubmit,
  children,
}: {
  readonly initial: string | null;
  readonly submitLabel: string;
  readonly busy?: boolean;
  readonly onSubmit: (name: string) => void;
  readonly children?: ReactNode;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = checkName(value);
    // The same mistake twice must still be announced.
    setMessage((previous) =>
      result.ok ? null : freshAnnouncement(previous, result.message),
    );
    if (result.ok) onSubmit(result.name);
  };

  return (
    <form className="name-form" onSubmit={submit}>
      <label htmlFor={id}>Your name</label>
      <input
        id={id}
        className="text-field"
        value={value}
        autoComplete="nickname"
        aria-invalid={message !== null}
        aria-describedby={`${id}-message`}
        onChange={(event) => setValue(event.target.value)}
      />
      <p id={`${id}-message`} role="alert" className="field-message">
        {message}
      </p>
      {children}
      <button type="submit" className="primary" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
