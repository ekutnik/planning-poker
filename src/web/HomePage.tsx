import { useState } from "react";
import { createRoom } from "./api.js";
import type { Identity } from "./identity.js";
import { NameForm } from "./NameForm.js";

export function HomePage({
  identity,
  onCreated,
}: {
  readonly identity: Identity;
  readonly onCreated: (roomId: string) => void;
}) {
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
    <main>
      <h1>Planning Poker</h1>
      <p>Estimate together. Votes stay hidden until everyone reveals.</p>
      <NameForm
        initial={identity.lastName()}
        submitLabel="Create a room"
        busy={busy}
        onSubmit={create}
      />
      {failed && (
        <p role="alert">
          The room could not be created. Check your connection and try again.
        </p>
      )}
    </main>
  );
}
