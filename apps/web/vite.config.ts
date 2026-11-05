import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The app version lives in the repository's root package.json (shared with the desktop app).
const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };

/**
 * Content Security Policy for the production build.
 * `connect-src` is the browser-enforced version of the "allowed network calls"
 * list in CLAUDE.md. Add an endpoint here only together with that list.
 * Not applied in dev, because Vite's hot reload needs a websocket.
 */
const CONNECT_SRC = [
  "'self'",
  // Research search (only search words are sent)
  "https://www.ebi.ac.uk",
  "https://eutils.ncbi.nlm.nih.gov",
  // AI models are called by the local server (server/), never from the page.
];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Base UI and Recharts set inline style attributes for positioning.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${CONNECT_SRC.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base so the static build works from any GitHub Pages path.
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  // Shown on Settings → About.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // In dev, the page talks to the local server (apps/server, started with it by `bun dev`) through Vite.
  // BT_PORT moves both, e.g. to run beside another copy of the app.
  // Under `bun run desktop:dev` the window opens port 5173 (tauri.dev.conf.json), so Vite must not move to
  // another port when it is taken: that could open another copy of the app.
  server: {
    strictPort: Boolean(process.env.TAURI_ENV_PLATFORM),
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.BT_PORT || 4820}`, changeOrigin: true } },
  },
});
