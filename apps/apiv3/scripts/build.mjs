import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/http.ts", "src/worker.ts"],
  outdir: "dist",
  platform: "node",
  format: "esm",
  target: "node24",
  bundle: true,
  sourcemap: true,
  // The Prisma client is generated per schema and loads its engine from disk.
  external: ["@prisma/client", ".prisma/client"],
  // Bundled CJS dependencies call require(); ESM output has none by default.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
