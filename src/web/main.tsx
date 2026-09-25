import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadIdentity, newToken } from "./identity.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./index.css";
import { createRouter } from "./router.js";
import { createThemeStore } from "./theme.js";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

const router = createRouter(window);
const identity = loadIdentity(
  () => window.localStorage,
  () => newToken(crypto),
);
const theme = createThemeStore(
  () => window.localStorage,
  document.documentElement,
);

createRoot(root).render(
  <StrictMode>
    <App router={router} identity={identity} theme={theme} />
  </StrictMode>,
);
