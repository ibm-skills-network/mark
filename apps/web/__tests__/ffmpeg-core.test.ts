/**
 * The learner video recorder loads the vendored ffmpeg core from
 * `public/ffmpeg-core/` and does all of its audio extraction in the browser. A
 * minifier, formatter or "dead code" pass that touches that emscripten glue can
 * leave a file that still parses, still resolves `createFFmpegCore()`, and still
 * reports `loaded === true` — while never instantiating the WebAssembly module,
 * so the first `FS.writeFile` throws and every recording fails.
 *
 * These tests exercise the real vendored pair end to end (instantiate, write,
 * transcode, read) so that class of corruption cannot reach a release again.
 *
 * @jest-environment node
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const CORE_DIR = path.join(__dirname, "..", "public", "ffmpeg-core");
const CORE_JS = path.join(CORE_DIR, "ffmpeg-core.js");
const CORE_WASM = path.join(CORE_DIR, "ffmpeg-core.wasm");

interface FfmpegCoreFileSystem {
  writeFile: (filePath: string, data: Uint8Array) => void;
  readFile: (filePath: string, options: { encoding: "binary" }) => Uint8Array;
  stat: (filePath: string) => { size: number };
  unlink: (filePath: string) => void;
}

interface FfmpegCoreModule {
  _ffmpeg?: unknown;
  asm?: unknown;
  ret: number;
  FS: FfmpegCoreFileSystem;
  exec: (...args: string[]) => void;
  setLogger: (callback: (data: unknown) => void) => void;
  setProgress: (callback: (data: unknown) => void) => void;
  setTimeout: (milliseconds: number) => void;
}

type CreateFfmpegCore = (options: {
  wasmBinary: Uint8Array;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}) => Promise<FfmpegCoreModule>;

/** A second of a 440 Hz tone as 16-bit mono PCM in a WAV container. */
function buildWav(seconds = 0.5, sampleRate = 8000): Uint8Array {
  const sampleCount = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) {
    const amplitude = Math.round(
      3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate),
    );
    buffer.writeInt16LE(amplitude, 44 + i * 2);
  }
  return new Uint8Array(buffer);
}

async function loadVendoredCore(): Promise<FfmpegCoreModule> {
  // createRequire bypasses the jest module registry: the glue is a vendored
  // build artefact and must be loaded exactly as the browser loads it.
  // The updated browser-only core reads the worker location during startup.
  // Supply that browser global while still executing the real WASM in Node.
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      location: { href: "http://localhost/ffmpeg-core/ffmpeg-core.js" },
    },
  });
  const requireFromHere = createRequire(__filename);
  const createFfmpegCore = requireFromHere(CORE_JS) as CreateFfmpegCore;
  return createFfmpegCore({
    wasmBinary: new Uint8Array(readFileSync(CORE_WASM)),
    print: () => undefined,
    printErr: () => undefined,
  });
}

describe("vendored ffmpeg core", () => {
  jest.setTimeout(120000);

  it("instantiates its WebAssembly module", async () => {
    const core = await loadVendoredCore();

    // Both are wired up by the glue's `createWasm()` call. If the call site is
    // missing, the factory still resolves and these are undefined.
    expect(typeof core._ffmpeg).toBe("function");
    expect(core.asm).toBeDefined();
  });

  it("writes a recording into its filesystem and extracts the audio track", async () => {
    const core = await loadVendoredCore();
    const recording = buildWav();

    core.FS.writeFile("input.webm", recording);
    expect(core.FS.stat("input.webm").size).toBe(recording.length);

    core.setLogger(() => undefined);
    core.setProgress(() => undefined);
    core.setTimeout(-1);
    core.exec(
      "-i",
      "input.webm",
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "output.wav",
    );

    expect(core.ret).toBe(0);
    expect(
      core.FS.readFile("output.wav", { encoding: "binary" }).length,
    ).toBeGreaterThan(0);

    core.FS.unlink("input.webm");
    core.FS.unlink("output.wav");
  });

  it("matches the published @ffmpeg/core distribution it is vendored from", () => {
    const requireFromHere = createRequire(__filename);
    let publishedJs: string;
    let publishedWasm: string;
    try {
      publishedJs = requireFromHere.resolve("@ffmpeg/core");
      publishedWasm = requireFromHere.resolve("@ffmpeg/core/wasm");
    } catch {
      throw new Error(
        "@ffmpeg/core is not installed — run yarn install so the vendored core can be checked against the published dist",
      );
    }

    const digest = (filePath: string) =>
      createHash("sha256").update(readFileSync(filePath)).digest("hex");

    expect(digest(CORE_JS)).toBe(digest(publishedJs));
    expect(digest(CORE_WASM)).toBe(digest(publishedWasm));
  });
});
