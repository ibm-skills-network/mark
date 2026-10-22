/* eslint-disable unicorn/prefer-module -- Nest emits CommonJS; worker paths must resolve relative to the compiled module. */
import { spawn, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { realpathSync, readFile, readFileSync, existsSync } from "node:fs";

import type { ParserLimits, ParserDocument } from "./parser.types";
export type { ParserLimits, ParserDocument } from "./parser.types";
export const ARTIFACT_EXTRACTOR_VERSION = "1.0.0";
function dependencyVersion(name: string): string {
  try {
    let directory = dirname(require.resolve(name));
    for (;;) {
      const metadataPath = join(directory, "package.json");
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        if (metadata.name === name && typeof metadata.version === "string")
          return metadata.version;
      }
      const parent = dirname(directory);
      if (parent === directory) return "unavailable";
      directory = parent;
    }
  } catch {
    return "unavailable";
  }
}
/** Package export maps need not expose package.json; resolve from the installed entrypoint. */
export const ARTIFACT_EXTRACTOR_DEPENDENCIES = Object.freeze({
  ...Object.fromEntries(
    ["pdfjs-dist", "sharp", "unzipper", "xml2js", "cheerio"].map((name) => [
      name,
      dependencyVersion(name),
    ]),
  ),
  node: process.versions.node,
  platform: `${process.platform}/${process.arch}`,
});

export const PARSER_LIMITS: Readonly<ParserLimits> = Object.freeze({
  inputBytes: 20 * 1024 * 1024,
  expandedBytes: 8 * 1024 * 1024,
  outputBytes: 12 * 1024 * 1024,
  pages: 200,
  timeoutMs: 30_000,
  heapMb: 256,
  rssMb: 512,
});
export type ParserFailureCode =
  | "input_limit"
  | "expansion_limit"
  | "output_limit"
  | "timeout"
  | "cancelled"
  | "dependency_unavailable"
  | "corrupt_input"
  | "parser_failure"
  | "unsupported_format";
export class ArtifactParserError extends Error {
  constructor(public readonly code: ParserFailureCode) {
    super(`Artifact parsing failed: ${code}`);
  }
}

/** No temporary files, credentials, environment inheritance or browser extraction. */
export async function parseArtifactIsolated(
  bytes: Buffer,
  format: string,
  filename = "",
  signal?: AbortSignal,
  overrides: Partial<ParserLimits> = {},
): Promise<ParserDocument> {
  if (Object.values(ARTIFACT_EXTRACTOR_DEPENDENCIES).includes("unavailable")) {
    throw new ArtifactParserError("dependency_unavailable");
  }
  const limits = { ...PARSER_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > PARSER_LIMITS[key]
    )
      throw new Error(`Invalid parser limit: ${key}`);
  }
  if (bytes.length > limits.inputBytes)
    throw new ArtifactParserError("input_limit");
  if (signal?.aborted) throw new ArtifactParserError("cancelled");
  const worker = join(__dirname, "artifact.worker.js");
  const dependencies = dirname(
    dirname(realpathSync(require.resolve("pdfjs-dist/package.json"))),
  );
  const moduleRoots = (require.resolve.paths("pdfjs-dist") ?? []).filter(
    (path) => existsSync(path),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--permission",
        "--allow-addons",
        `--allow-fs-read=${__dirname}`,
        `--allow-fs-read=${dependencies}`,
        ...moduleRoots.map((path) => `--allow-fs-read=${path}`),
        `--max-old-space-size=${limits.heapMb}`,
        worker,
        format,
        filename,
        JSON.stringify(limits),
      ],
      { stdio: ["pipe", "pipe", "ignore"], env: { NODE_ENV: "production" } },
    );
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let failure: ParserFailureCode | undefined;
    let sampling = false;
    const stop = (code: ParserFailureCode) => {
      failure ??= code;
      child.kill("SIGKILL");
    };
    const cancel = () => stop("cancelled");
    const timeout = setTimeout(() => stop("timeout"), limits.timeoutMs);
    // Parent-side RSS sampling still runs while malicious input blocks worker JS.
    const memory = setInterval(() => {
      if (sampling || !child.pid) return;
      sampling = true;
      const check = (rssKb: number) => {
        sampling = false;
        if (rssKb > limits.rssMb * 1024) stop("expansion_limit");
      };
      if (process.platform === "linux") {
        readFile(`/proc/${child.pid}/status`, "utf8", (error, status) => {
          check(error ? 0 : Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0));
        });
      } else {
        execFile(
          "/bin/ps",
          ["-o", "rss=", "-p", String(child.pid)],
          { timeout: 1000 },
          (error, stdout) => {
            check(error ? 0 : Number(stdout.trim()));
          },
        );
      }
    }, 100);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > limits.outputBytes) stop("output_limit");
      else chunks.push(chunk);
    });
    child.stdin.on("error", () => {
      /* Intentionally discard diagnostics; stdout is the bounded protocol. */
    }); // EPIPE is classified by exit/failure.
    child.on("error", () => {
      failure ??= "dependency_unavailable";
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(memory);
      signal?.removeEventListener("abort", cancel);
      if (failure) {
        reject(new ArtifactParserError(failure));
        return;
      }
      try {
        const result = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as ParserDocument & { failure?: ParserFailureCode };
        if (result.failure) throw new ArtifactParserError(result.failure);
        if (
          code !== 0 ||
          !Array.isArray(result.blocks) ||
          !Array.isArray(result.omissions)
        )
          throw new ArtifactParserError("parser_failure");
        resolve(result);
      } catch (error) {
        reject(
          error instanceof ArtifactParserError
            ? error
            : new ArtifactParserError("parser_failure"),
        );
      }
    });
    child.stdin.end(bytes);
  });
}
