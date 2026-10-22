/* eslint-disable unicorn/prefer-module -- Worker resolves CommonJS adapters after network APIs are disabled. */
/* eslint-disable unicorn/prefer-switch -- Dispatch loads one trusted adapter lazily. */
/** Trusted offline worker. stdout is exclusively the bounded JSON protocol. */
import { createRequire, syncBuiltinESMExports } from "node:module";

const requireModule = createRequire(__filename);
const denyNetwork = () => {
  throw new Error("Network disabled in artifact parser");
};
for (const [name, methods] of Object.entries({
  net: ["connect", "createConnection", "createServer"],
  tls: ["connect", "createServer"],
  http: ["request", "get", "createServer"],
  https: ["request", "get", "createServer"],
  dgram: ["createSocket"],
  dns: ["lookup", "resolve", "resolve4", "resolve6"],
})) {
  const module = requireModule(`node:${name}`) as Record<string, unknown>;
  for (const method of methods) module[method] = denyNetwork;
}
globalThis.fetch = denyNetwork;
syncBuiltinESMExports();
console.log =
  console.warn =
  console.info =
    () => {
      /* Intentionally discard diagnostics; stdout is the bounded protocol. */
    };

async function run() {
  const [format, filename, encodedLimits] = process.argv.slice(2);
  const limits = JSON.parse(
    encodedLimits,
  ) as import("./parser.types").ParserLimits;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of process.stdin) {
    const chunk = Buffer.from(raw as Uint8Array);
    size += chunk.length;
    if (size > limits.inputBytes) throw new Error("input_limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  let result: import("./parser.types").ParserDocument;
  switch (format) {
    case "pdf": {
      result = await (
        requireModule("./adapter-pdf") as typeof import("./adapter-pdf")
      ).extractPdf(bytes, limits);
      break;
    }
    case "notebook": {
      result = await (
        requireModule(
          "./adapter-notebook",
        ) as typeof import("./adapter-notebook")
      ).extractNotebook(bytes, limits);
      break;
    }
    case "archive": {
      result = await (
        requireModule("./adapter-archive") as typeof import("./adapter-archive")
      ).extractArchive(bytes, limits);
      break;
    }
    case "url": {
      result = await (
        requireModule("./adapter-url") as typeof import("./adapter-url")
      ).extractUrl(bytes, limits, filename);
      break;
    }
    case "text": {
      const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
      if (bytes.length > limits.expandedBytes)
        throw new Error("expansion_limit");
      result = {
        blocks: text
          ? [
              {
                kind: "text",
                text,
                location: { lineStart: 1, lineEnd: text.split("\n").length },
              },
            ]
          : [],
        omissions: [],
        expandedBytes: bytes.length,
        empty: text.length === 0,
      };

      break;
    }
    default: {
      result = await (
        requireModule("./media-adapters") as typeof import("./media-adapters")
      ).extractMedia(bytes, limits, format, filename);
    }
  }
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > limits.outputBytes)
    throw new Error("output_limit");
  process.stdout.write(output);
}
run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const errorCode = (error as { code?: string })?.code;
  const allowed = new Set([
    "input_limit",
    "expansion_limit",
    "output_limit",
    "unsupported_format",
    "corrupt_input",
  ]);
  const dependencyFailure = [
    "MODULE_NOT_FOUND",
    "ERR_MODULE_NOT_FOUND",
    "ERR_DLOPEN_FAILED",
    "ERR_ACCESS_DENIED",
  ].includes(errorCode);
  const code = dependencyFailure
    ? "dependency_unavailable"
    : (error as Error)?.name === "PasswordException"
      ? "unsupported_format"
      : allowed.has(errorCode)
        ? errorCode
        : allowed.has(message)
          ? message
          : "corrupt_input";
  process.stdout.write(JSON.stringify({ failure: code }));
  process.exitCode = 1;
});
