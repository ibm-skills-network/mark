import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/compare-backends.mjs", import.meta.url),
);

const servers: Server[] = [];
const seenHeaders: string[] = [];

async function serve(body: string, status = 200): Promise<string> {
  const server = createServer((req, res) => {
    const header = req.headers["user-session"];
    if (typeof header === "string") seenHeaders.push(header);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function run(env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      // Piped on stdin, as it is run in the gateway pod.
      const child = spawn(process.execPath, ["-"], {
        env: { PATH: process.env.PATH ?? "", ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      createReadStream(script).pipe(child.stdin);
    },
  );
}

afterEach(async () => {
  seenHeaders.length = 0;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function expectNoHeaderValues(output: string) {
  expect(seenHeaders.length).toBeGreaterThan(0);
  for (const header of seenHeaders) expect(output).not.toContain(header);
  expect(output).not.toContain("a@b.co");
}

describe("compare-backends script", () => {
  it("exits 0 when both backends return the same bytes", async () => {
    const a = await serve('{"ok":true}');
    const b = await serve('{"ok":true}');
    const result = await run({ MARK_API_ENDPOINT: a, MARK_V3_API_ENDPOINT: b });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MATCH");
    expect(result.stdout).not.toContain("DIFF");
    expectNoHeaderValues(result.stdout + result.stderr);
  });

  it("exits 1 and reports the first differing offset on a byte difference", async () => {
    const a = await serve('{"ok":true}');
    const b = await serve('{"ok":false}');
    const result = await run({ MARK_API_ENDPOINT: a, MARK_V3_API_ENDPOINT: b });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("DIFF");
    expect(result.stdout).toContain("first differing offset 6");
    expectNoHeaderValues(result.stdout + result.stderr);
  });

  it("exits 1 when only the status differs", async () => {
    const a = await serve('{"ok":true}', 200);
    const b = await serve('{"ok":true}', 500);
    const result = await run({ MARK_API_ENDPOINT: a, MARK_V3_API_ENDPOINT: b });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      /^DIFF user-session gateway learner 200\/500$/m,
    );
    expect(result.stdout).not.toContain("first differing offset");
  });

  it("exits 1 and names the network error when a backend is unreachable", async () => {
    const a = await serve('{"ok":true}');
    const closed = await serve("{}");
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
    const result = await run({
      MARK_API_ENDPOINT: a,
      MARK_V3_API_ENDPOINT: closed,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      /^ERROR user-session gateway learner TypeError ECONNREFUSED$/m,
    );
    expectNoHeaderValues(result.stdout + result.stderr);
  });

  it("exits 2 when an endpoint variable is missing", async () => {
    const a = await serve("{}");
    const result = await run({ MARK_API_ENDPOINT: a });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("MARK_V3_API_ENDPOINT");
  });
});
