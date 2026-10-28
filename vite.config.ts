import fs from "node:fs";
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

/**
 * Text recognition (photos, scanned PDFs) runs in the browser with Tesseract. Its worker, engine and
 * language files are served by the app at ocr/ instead of a CDN: nothing is fetched from elsewhere.
 * The engine comes in variants for different CPU features; Tesseract picks one, so all LSTM variants ship.
 */
const OCR_FILES: Record<string, string> = {
  "worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "deu.traineddata.gz": "node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz",
  "hun.traineddata.gz": "node_modules/@tesseract.js-data/hun/4.0.0_best_int/hun.traineddata.gz",
};

function ocrAssets(): Plugin {
  return {
    name: "ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([\w.-]+)$/.exec((req.url ?? "").split("?")[0]!);
        const src = m && OCR_FILES[m[1]!];
        if (!src) return next();
        res.setHeader("content-type", src.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        fs.createReadStream(src).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(OCR_FILES)) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: fs.readFileSync(src) });
    },
  };
}

export default defineConfig({
  // Relative base so the static build works from any GitHub Pages path.
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy(), ocrAssets()],
  // In dev, the page talks to the local server (bun run server) through Vite.
  server: { proxy: { "/api": { target: "http://127.0.0.1:4820", changeOrigin: true } } },
  test: {
    projects: [
      { test: { name: "core", include: ["tests/core/**/*.test.ts", "tests/knowledge/**/*.test.ts", "tests/research/**/*.test.ts", "tests/ai/**/*.test.ts", "tests/db/**/*.test.ts", "tests/app/**/*.test.ts"], environment: "node" } },
      // the local server, against a throwaway data folder (never data/)
      { test: { name: "server", include: ["tests/server/**/*.test.ts"], environment: "node", setupFiles: ["tests/server/setup.ts"], isolate: true, testTimeout: 30_000 } },
    ],
  },
});
