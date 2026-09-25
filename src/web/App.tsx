import { useSyncExternalStore } from "react";
import type { FacilitateStore } from "./facilitate.js";
import { Header } from "./Header.js";
import { HomePage } from "./HomePage.js";
import type { Identity } from "./identity.js";
import { RoomPage } from "./RoomPage.js";
import { roomPath, type Router } from "./router.js";
import type { ThemeStore } from "./theme.js";

export function App({
  router,
  identity,
  theme,
  facilitate,
}: {
  readonly router: Router;
  readonly identity: Identity;
  readonly theme: ThemeStore;
  readonly facilitate: FacilitateStore;
}) {
  const route = useSyncExternalStore(router.subscribe, router.getRoute);
  const home = () => router.navigate("/");
  switch (route.name) {
    case "home":
      return (
        <>
          <Header theme={theme} />
          <HomePage
            identity={identity}
            onCreated={(roomId) => router.navigate(roomPath(roomId))}
          />
        </>
      );
    case "room":
      return (
        <RoomPage
          key={route.roomId}
          roomId={route.roomId}
          identity={identity}
          stores={{ theme, facilitate }}
          onHome={home}
        />
      );
    case "not-found":
      return (
        <>
          <Header theme={theme} />
          <main>
            <h1>There is no room here.</h1>
            <p>Check the link, or start a new room.</p>
            <button type="button" onClick={home}>
              Start a room
            </button>
          </main>
        </>
      );
  }
}
