import { useState } from "react";
import { createRoom } from "./api.js";
import { HOME_COPY } from "./copy.js";
import type { Identity } from "./identity.js";
import { NameForm } from "./NameForm.js";
import { ScreenHeading } from "./ScreenHeading.js";
import { useDocumentTitle } from "./title.js";

/** The landing page: a name, one button, and the promise the tool keeps. */
export function HomePage({
  identity,
  onCreated,
}: {
  readonly identity: Identity;
  readonly onCreated: (roomId: string) => void;
}) {
  useDocumentTitle(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const create = (name: string) => {
    setBusy(true);
    setFailed(false);
    createRoom().then(
      (roomId) => {
        identity.rememberName(name);
        onCreated(roomId);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <main className="page">
      <ScreenHeading>{HOME_COPY.heading}</ScreenHeading>
      <p>{HOME_COPY.intro}</p>
      <NameForm
        initial={identity.lastName()}
        submitLabel={HOME_COPY.submit}
        busy={busy}
        onSubmit={create}
      />
      <p>{HOME_COPY.invite}</p>
      {failed && <p role="alert">{HOME_COPY.failed}</p>}
    </main>
  );
}
