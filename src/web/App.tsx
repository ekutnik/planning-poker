import { useSyncExternalStore } from "react";
import { Header } from "./Header.js";
import type { Identity } from "./identity.js";
import { HomePage } from "./HomePage.js";
import { RoomPage } from "./RoomPage.js";
import { roomPath, type Router } from "./router.js";
import type { ThemeStore } from "./theme.js";

export function App({
  router,
  identity,
  theme,
}: {
  readonly router: Router;
  readonly identity: Identity;
  readonly theme: ThemeStore;
}) {
  return (
    <>
      <Header theme={theme} />
      <Screen router={router} identity={identity} />
    </>
  );
}

function Screen({
  router,
  identity,
}: {
  readonly router: Router;
  readonly identity: Identity;
}) {
  const route = useSyncExternalStore(router.subscribe, router.getRoute);
  const home = () => router.navigate("/");
  switch (route.name) {
    case "home":
      return (
        <HomePage
          identity={identity}
          onCreated={(roomId) => router.navigate(roomPath(roomId))}
        />
      );
    case "room":
      return (
        <RoomPage
          key={route.roomId}
          roomId={route.roomId}
          identity={identity}
          onHome={home}
        />
      );
    case "not-found":
      return (
        <main>
          <h1>There is no room here.</h1>
          <p>Check the link, or start a new room.</p>
          <button type="button" onClick={home}>
            Start a room
          </button>
        </main>
      );
  }
}
