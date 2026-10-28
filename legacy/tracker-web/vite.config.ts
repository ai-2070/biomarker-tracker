import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  // AI providers the user configures with their own key (only after they confirm what is sent)
  "https://api.anthropic.com",
  "https://api.openai.com",
  // Local Ollama (must match OLLAMA_ALLOWED in src/ai/providers.ts)
  "http://localhost:11434",
  "http://127.0.0.1:11434",
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
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
