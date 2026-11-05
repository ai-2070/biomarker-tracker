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

/** A package's folder in node_modules, looked up from here towards the repository root (hoisted installs). */
function packageDir(name: string): string {
  for (let dir = import.meta.dirname; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`${name} is not installed (bun install).`);
  }
}
/**
 * Text recognition (photos, scanned PDFs) runs in the browser with Tesseract. Its worker, engine and
 * language files are served by the app at ocr/ instead of a CDN: nothing is fetched from elsewhere.
 * The engine comes in variants for different CPU features; Tesseract picks one, so all LSTM variants ship.
 */
const OCR_SOURCES: Record<string, [string, string]> = {
  "worker.min.js": ["tesseract.js", "dist/worker.min.js"],
  "tesseract-core-lstm.wasm.js": ["tesseract.js-core", "tesseract-core-lstm.wasm.js"],
  "tesseract-core-simd-lstm.wasm.js": ["tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"],
  "tesseract-core-relaxedsimd-lstm.wasm.js": ["tesseract.js-core", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  "eng.traineddata.gz": ["@tesseract.js-data/eng", "4.0.0_best_int/eng.traineddata.gz"],
  "deu.traineddata.gz": ["@tesseract.js-data/deu", "4.0.0_best_int/deu.traineddata.gz"],
  "hun.traineddata.gz": ["@tesseract.js-data/hun", "4.0.0_best_int/hun.traineddata.gz"],
};
const OCR_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(OCR_SOURCES).map(([name, [pkgName, file]]) => [name, path.join(packageDir(pkgName), file)]),
);

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
  // Shown on Settings → About.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // In dev, the page talks to the local server (apps/server, started with it by `bun dev`) through Vite.
  // BT_PORT moves both, e.g. to run beside another copy of the app.
  server: { proxy: { "/api": { target: `http://127.0.0.1:${process.env.BT_PORT || 4820}`, changeOrigin: true } } },
});
