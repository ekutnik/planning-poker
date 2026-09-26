import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createFacilitateStore } from "./facilitate.js";
import { loadIdentity, newToken } from "./identity.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./index.css";
import "./styles/room.css";
import "./styles/pages.css";
import { createRouter } from "./router.js";
import { trackFocus } from "./focus.js";
import { watchStorage } from "./storage.js";
import { createThemeStore } from "./theme.js";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

trackFocus(document);
const router = createRouter(window);
const identity = loadIdentity(
  () => window.localStorage,
  () => newToken(crypto),
);
const facilitate = createFacilitateStore(() => window.localStorage);
const theme = createThemeStore(
  () => window.localStorage,
  document.documentElement,
  watchStorage(window),
);

createRoot(root).render(
  <StrictMode>
    <App
      router={router}
      identity={identity}
      theme={theme}
      facilitate={facilitate}
    />
  </StrictMode>,
);
