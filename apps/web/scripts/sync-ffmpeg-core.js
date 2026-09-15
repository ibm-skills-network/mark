/**
 * Keeps `public/ffmpeg-core/` in step with the pinned `@ffmpeg/core` release.
 *
 * The learner video recorder loads this emscripten glue and its WebAssembly
 * binary straight out of `public/`. They are build artefacts, not source: a
 * formatter, minifier or "dead code" pass that edits them can produce a file
 * that still parses and still resolves `createFFmpegCore()` while never
 * instantiating the WebAssembly module — which fails at the first file write,
 * inside a worker, with no server-side trace.
 *
 * So on every build the published copies win over whatever is on disk, and if
 * the published package is not installed the vendored pair is at least checked
 * for the markers that instantiation depends on.
 */
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public", "ffmpeg-core");

const TARGETS = [
  { fileName: "ffmpeg-core.js", specifier: "@ffmpeg/core" },
  { fileName: "ffmpeg-core.wasm", specifier: "@ffmpeg/core/wasm" },
];

// Present in every intact build of the glue, formatted or minified: the call
// that instantiates the module, and the start function it registers.
const GLUE_MARKERS = [/=createWasm\(\)/, /___wasm_call_ctors=/];

function resolvePublished(specifier) {
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

function publishedVersion(resolvedFile) {
  // The package does not export its manifest, so read it next to the dist file.
  try {
    const manifest = path.join(
      path.dirname(resolvedFile),
      "..",
      "..",
      "package.json",
    );
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  } catch {
    return "unknown";
  }
}

function missingGlueMarkers(filePath) {
  const source = fs.readFileSync(filePath, "utf8").replace(/\s+/g, "");
  return GLUE_MARKERS.filter((marker) => !marker.test(source)).map(String);
}

function main() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const problems = [];

  for (const { fileName, specifier } of TARGETS) {
    const vendored = path.join(PUBLIC_DIR, fileName);
    const published = resolvePublished(specifier);

    if (published) {
      const publishedBytes = fs.readFileSync(published);
      const vendoredBytes = fs.existsSync(vendored)
        ? fs.readFileSync(vendored)
        : null;
      if (!vendoredBytes || !publishedBytes.equals(vendoredBytes)) {
        fs.writeFileSync(vendored, publishedBytes);
        console.log(
          `sync-ffmpeg-core: refreshed public/ffmpeg-core/${fileName} from @ffmpeg/core@${publishedVersion(published)}`,
        );
      }
    } else if (!fs.existsSync(vendored)) {
      problems.push(
        `public/ffmpeg-core/${fileName} is missing and @ffmpeg/core is not installed`,
      );
      continue;
    }

    const { size } = fs.statSync(vendored);
    if (size === 0) {
      problems.push(`public/ffmpeg-core/${fileName} is empty`);
    }
  }

  const glueFile = path.join(PUBLIC_DIR, "ffmpeg-core.js");
  if (fs.existsSync(glueFile)) {
    const missing = missingGlueMarkers(glueFile);
    if (missing.length > 0) {
      problems.push(
        `public/ffmpeg-core/ffmpeg-core.js does not instantiate its WebAssembly module (missing ${missing.join(", ")}) — it has been edited; reinstall @ffmpeg/core`,
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`sync-ffmpeg-core: ${problem}`);
    }
    process.exit(1);
  }
}

main();
