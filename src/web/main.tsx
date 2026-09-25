import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadIdentity, newToken } from "./identity.js";
import "./index.css";
import { createRouter } from "./router.js";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

const router = createRouter(window);
const identity = loadIdentity(
  () => window.localStorage,
  () => newToken(crypto),
);

createRoot(root).render(
  <StrictMode>
    <App router={router} identity={identity} />
  </StrictMode>,
);
