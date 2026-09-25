import { useId, useState, type FormEvent } from "react";
import { checkName } from "./view.js";

/** A name field validated by the shared rule, so it accepts what the server does. */
export function NameForm({
  initial,
  submitLabel,
  busy = false,
  onSubmit,
}: {
  readonly initial: string | null;
  readonly submitLabel: string;
  readonly busy?: boolean;
  readonly onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = checkName(value);
    setMessage(result.ok ? null : result.message);
    if (result.ok) onSubmit(result.name);
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor={id}>Your name</label>
      <input
        id={id}
        value={value}
        autoComplete="nickname"
        aria-invalid={message !== null}
        aria-describedby={message ? `${id}-message` : undefined}
        onChange={(event) => setValue(event.target.value)}
      />
      {message && <p id={`${id}-message`}>{message}</p>}
      <button type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
