import { type SpawnOptions, spawn } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GradingLogger } from "../contracts";
import {
  RENDER_MAX_CONCURRENT,
  RENDER_MAX_PDF_BYTES,
  RENDER_TIMEOUT_MS,
} from "../limits";

/**
 * Office file → PDF with LibreOffice headless. Every conversion gets a fresh
 * temp directory and profile, removed afterwards. The input is untrusted:
 * no shell, a profile that keeps macros and remote links off, a minimal
 * environment, and a timeout that kills the whole process group.
 */

export type RenderFailureCode =
  | "unavailable"
  | "unsupported"
  | "timeout"
  | "failed"
  | "no_output"
  | "too_large";

export interface RenderFailure {
  ok: false;
  code: RenderFailureCode;
  message: string;
}

export function isRenderFailure(
  value: Buffer | RenderFailure,
): value is RenderFailure {
  return !Buffer.isBuffer(value);
}

/** The slice of ChildProcess the renderer uses; tests pass a fake. */
export interface RenderProcess {
  pid?: number;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export type RenderSpawner = (
  command: string,
  commandArguments: string[],
  options: SpawnOptions,
) => RenderProcess;

export interface RenderOptions {
  /** soffice binary; resolved from the environment when left out. */
  binary: string;
  logger?: GradingLogger;
  timeoutMs?: number;
  spawner?: RenderSpawner;
  /** Signals a process group; defaults to process.kill(-pid). */
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  /** Parent of the per-conversion temp directory. */
  tempRoot?: string;
  maxPdfBytes?: number;
}

/** Extensions we convert. Macro-enabled formats (xlsm, docm, pptm) are not. */
export const RENDERABLE_EXTENSIONS = new Set(["pptx", "docx", "xlsx"]);

const MAC_SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
/** How long to wait for a killed process to exit before cleaning up anyway. */
const KILL_GRACE_MS = 5000;

// Seeded into the fresh profile before LibreOffice starts: macros never run
// (very high security level and execution disabled), links from untrusted
// documents are blocked, and Calc never updates external links on load.
const HARDENED_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
</oor:items>
`;

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return statSync(file).isFile();
  } catch {
    // Missing or not executable: the caller tries the next candidate.
    return false;
  }
}

/**
 * LIBREOFFICE_PATH, else soffice on PATH, else the macOS app bundle.
 * Undefined when none is executable. Synchronous: a few stat calls, once.
 */
export function resolveSofficeBinary(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = environment.LIBREOFFICE_PATH?.trim();
  if (configured) {
    return isExecutable(configured) ? configured : undefined;
  }
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, "soffice");
    if (isExecutable(candidate)) return candidate;
  }
  return isExecutable(MAC_SOFFICE) ? MAC_SOFFICE : undefined;
}

function failure(code: RenderFailureCode, message: string): RenderFailure {
  return { ok: false, code, message };
}

function defaultKillGroup(pid: number, signal: NodeJS.Signals): void {
  process.kill(-pid, signal);
}

interface ExitResult {
  kind: "exit" | "error" | "timeout";
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

/** Convert one file. Never throws for a bad file or a missing binary. */
export async function renderToPdf(
  buffer: Buffer,
  extension: string,
  options: RenderOptions,
): Promise<Buffer | RenderFailure> {
  const logger = options.logger;
  const format = extension.toLowerCase();
  if (!RENDERABLE_EXTENSIONS.has(format)) {
    return failure("unsupported", `.${format} files are not rendered`);
  }
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;
  const maxPdfBytes = options.maxPdfBytes ?? RENDER_MAX_PDF_BYTES;
  const spawner: RenderSpawner =
    options.spawner ??
    ((command, commandArguments, spawnOptions) =>
      spawn(command, commandArguments, spawnOptions));
  const killGroup = options.killGroup ?? defaultKillGroup;
  const started = Date.now();
  let workDirectory: string | undefined;
  logger?.info("grading.v3.render.start", {
    extension: format,
    bytes: buffer.length,
  });

  const done = (
    result: Buffer | RenderFailure,
    meta: Record<string, unknown> = {},
  ): Buffer | RenderFailure => {
    const durationMs = Date.now() - started;
    if (isRenderFailure(result)) {
      logger?.warn("grading.v3.render.failed", {
        extension: format,
        code: result.code,
        reason: result.message,
        durationMs,
        ...meta,
      });
    } else {
      logger?.info("grading.v3.render.done", {
        extension: format,
        pdfBytes: result.length,
        durationMs,
      });
    }
    return result;
  };

  try {
    workDirectory = await mkdtemp(
      path.join(options.tempRoot ?? tmpdir(), "mark-render-"),
    );
    const profileDirectory = path.join(workDirectory, "profile");
    const inputDirectory = path.join(workDirectory, "in");
    const outputDirectory = path.join(workDirectory, "out");
    await mkdir(path.join(profileDirectory, "user"), { recursive: true });
    await mkdir(inputDirectory);
    await mkdir(outputDirectory);
    await writeFile(
      path.join(profileDirectory, "user", "registrymodifications.xcu"),
      HARDENED_PROFILE,
    );
    // Fixed name: the learner's file name never reaches the command line.
    const inputFile = path.join(inputDirectory, `input.${format}`);
    await writeFile(inputFile, buffer);

    const commandArguments = [
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      outputDirectory,
      inputFile,
    ];
    const child = spawner(options.binary, commandArguments, {
      // Own process group, so a timeout can kill soffice and its children.
      detached: true,
      stdio: "ignore",
      cwd: workDirectory,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: workDirectory,
        TMPDIR: workDirectory,
        LANG: "en_US.UTF-8",
      },
    });

    let exited = false;
    let notifyExit: (() => void) | undefined;
    const exitResult = await new Promise<ExitResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ kind: "timeout" });
      }, timeoutMs);
      child.once("exit", (code, signal) => {
        exited = true;
        clearTimeout(timer);
        notifyExit?.();
        resolve({ kind: "exit", code, signal });
      });
      child.once("error", (error) => {
        exited = true;
        clearTimeout(timer);
        notifyExit?.();
        resolve({ kind: "error", error });
      });
    });

    if (exitResult.kind === "timeout") {
      if (child.pid !== undefined) {
        try {
          killGroup(child.pid, "SIGKILL");
        } catch (error) {
          logger?.warn("grading.v3.render.kill_failed", {
            pid: child.pid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Let the process go before its temp directory is removed.
      if (!exited) {
        await new Promise<void>((resolve) => {
          const grace = setTimeout(resolve, KILL_GRACE_MS);
          notifyExit = () => {
            clearTimeout(grace);
            resolve();
          };
        });
      }
      return done(
        failure("timeout", `LibreOffice took longer than ${timeoutMs} ms`),
      );
    }
    if (exitResult.kind === "error") {
      const code = (exitResult.error as NodeJS.ErrnoException | undefined)
        ?.code;
      return done(
        failure(
          code === "ENOENT" || code === "EACCES" ? "unavailable" : "failed",
          `LibreOffice could not start: ${exitResult.error?.message ?? "unknown error"}`,
        ),
      );
    }
    if (exitResult.code !== 0) {
      return done(
        failure(
          "failed",
          `LibreOffice exited with ${exitResult.code ?? exitResult.signal}`,
        ),
        { exitCode: exitResult.code, signal: exitResult.signal },
      );
    }
    const outputFile = path.join(outputDirectory, "input.pdf");
    let size: number;
    try {
      const output = await stat(outputFile);
      size = output.size;
    } catch {
      // soffice exits 0 even when it could not load the file.
      return done(failure("no_output", "LibreOffice produced no PDF"));
    }
    if (size > maxPdfBytes) {
      return done(
        failure(
          "too_large",
          `rendered PDF is ${size} bytes, over ${maxPdfBytes}`,
        ),
      );
    }
    return done(await readFile(outputFile));
  } catch (error) {
    logger?.error("grading.v3.render.error", {
      extension: format,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return done(
      failure(
        "failed",
        error instanceof Error ? error.message : "render failed",
      ),
    );
  } finally {
    if (workDirectory) {
      try {
        await rm(workDirectory, { recursive: true, force: true });
      } catch (error) {
        logger?.error("grading.v3.render.cleanup_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

// ── renderer used by materialize ────────────────────────────────────────────

export interface Renderer {
  /** `logger` overrides the renderer's own for this call. */
  toPdf(
    buffer: Buffer,
    extension: string,
    logger?: GradingLogger,
  ): Promise<Buffer | RenderFailure>;
  logger?: GradingLogger;
}

/** The same renderer (binary, queue) logging with a request's logger. */
export function rendererWithLogger(
  renderer: Renderer,
  logger: GradingLogger,
): Renderer {
  return {
    logger,
    toPdf: (buffer, extension) => renderer.toPdf(buffer, extension, logger),
  };
}

export interface CreateRendererOptions {
  logger?: GradingLogger;
  environment?: NodeJS.ProcessEnv;
  maxConcurrent?: number;
  /** Overrides for tests: binary lookup and the conversion itself. */
  resolveBinary?: () => string | undefined;
  render?: typeof renderToPdf;
  timeoutMs?: number;
}

/** True unless GRADING_V3_RENDER is "off". */
export function renderingEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.GRADING_V3_RENDER?.trim().toLowerCase() !== "off";
}

/**
 * The renderer for grading, or undefined when GRADING_V3_RENDER=off. The
 * binary is looked up once; when it is missing every call fails fast as
 * "unavailable" after one warning. Conversions beyond maxConcurrent wait.
 */
export function createRenderer(
  options: CreateRendererOptions = {},
): Renderer | undefined {
  const environment = options.environment ?? process.env;
  if (!renderingEnabled(environment)) return undefined;
  const logger = options.logger;
  const render = options.render ?? renderToPdf;
  const maxConcurrent = Math.max(
    1,
    options.maxConcurrent ?? RENDER_MAX_CONCURRENT,
  );
  let binary: { path: string | undefined } | undefined;
  let warned = false;
  let running = 0;
  const waiting: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (running < maxConcurrent) {
      running += 1;
      return;
    }
    // The releasing call hands its slot over, so running stays the same.
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return {
    logger,
    async toPdf(buffer, extension, callLogger) {
      const log = callLogger ?? logger;
      binary ??= {
        path: (
          options.resolveBinary ?? (() => resolveSofficeBinary(environment))
        )(),
      };
      const resolved = binary.path;
      if (!resolved) {
        if (!warned) {
          warned = true;
          log?.warn("grading.v3.render.unavailable", {
            reason:
              "LibreOffice not found (LIBREOFFICE_PATH, PATH, app bundle); grading with text only",
          });
        }
        return failure("unavailable", "LibreOffice is not installed");
      }
      await acquire();
      try {
        return await render(buffer, extension, {
          binary: resolved,
          logger: log,
          timeoutMs: options.timeoutMs,
        });
      } finally {
        release();
      }
    },
  };
}
