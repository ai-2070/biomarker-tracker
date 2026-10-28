import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initTheme } from "./app/theme";
// Fonts are bundled (Fontsource), so the strict CSP never needs a font service.
import "@fontsource-variable/inter";
import "@fontsource/instrument-serif";
import "@fontsource-variable/kode-mono";
import "./index.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
