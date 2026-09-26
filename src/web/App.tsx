import { useSyncExternalStore } from "react";
import { NOT_FOUND_COPY } from "./copy.js";
import type { FacilitateStore } from "./facilitate.js";
import { Header } from "./Header.js";
import { HomePage } from "./HomePage.js";
import type { Identity } from "./identity.js";
import { RoomPage } from "./RoomPage.js";
import { roomPath, type Router } from "./router.js";
import { ScreenHeading } from "./ScreenHeading.js";
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
          <NotFound onHome={home} />
        </>
      );
  }
}

function NotFound({ onHome }: { readonly onHome: () => void }) {
  return (
    <main className="page">
      <ScreenHeading>{NOT_FOUND_COPY.title}</ScreenHeading>
      <p>{NOT_FOUND_COPY.body}</p>
      <button type="button" className="primary" onClick={onHome}>
        {NOT_FOUND_COPY.action}
      </button>
    </main>
  );
}
