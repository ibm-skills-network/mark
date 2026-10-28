import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { GradingLogger } from "../contracts";
import {
  createRenderer,
  isRenderFailure,
  type RenderProcess,
  type RenderSpawner,
  renderToPdf,
  resolveSofficeBinary,
} from "./render";
import { chartWorkbook, textDeck, textDocument } from "./tests/office-fixtures";
import { chartSheetsWorkbook } from "./xlsx-render";

function recordingLogger(): GradingLogger & {
  entries: Array<{ level: string; message: string; meta?: unknown }>;
} {
  const entries: Array<{ level: string; message: string; meta?: unknown }> = [];
  const at =
    (level: string) => (message: string, meta?: Record<string, unknown>) =>
      entries.push({ level, message, meta });
  return {
    entries,
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}

class FakeProcess extends EventEmitter implements RenderProcess {
  constructor(readonly pid: number) {
    super();
  }
}

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv | undefined;
  detached: boolean | undefined;
}

/** Spawner that writes `pdf` (if given) into --outdir, then exits with code. */
function fakeSpawner(
  behaviour: { pdf?: Buffer; code?: number; hang?: boolean; error?: string },
  calls: SpawnCall[],
): { spawner: RenderSpawner; last: () => FakeProcess | undefined } {
  let last: FakeProcess | undefined;
  const spawner: RenderSpawner = (command, args, options) => {
    calls.push({
      command,
      args,
      env: options.env,
      detached: options.detached,
    });
    const child = new FakeProcess(4242);
    last = child;
    const outdir = args[args.indexOf("--outdir") + 1];
    setImmediate(() => {
      void (async () => {
        if (behaviour.error) {
          const error: NodeJS.ErrnoException = new Error(behaviour.error);
          error.code = behaviour.error;
          child.emit("error", error);
          return;
        }
        if (behaviour.hang) return;
        if (behaviour.pdf) {
          await writeFile(path.join(outdir, "input.pdf"), behaviour.pdf);
        }
        child.emit("exit", behaviour.code ?? 0, null);
      })();
    });
    return child;
  };
  return { spawner, last: () => last };
}

describe("renderToPdf with a fake soffice", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "render-spec-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("runs soffice without a shell, with a fresh profile and a fixed input name", async () => {
    const calls: SpawnCall[] = [];
    const { spawner } = fakeSpawner({ pdf: Buffer.from("%PDF-1.7") }, calls);
    const result = await renderToPdf(Buffer.from("deck"), "PPTX", {
      binary: "/opt/soffice",
      spawner,
      tempRoot,
    });
    expect(Buffer.isBuffer(result) && result.toString()).toBe("%PDF-1.7");
    const [call] = calls;
    expect(call.command).toBe("/opt/soffice");
    expect(call.detached).toBe(true);
    expect(call.args[0]).toMatch(
      /^-env:UserInstallation=file:\/\/.+\/profile$/,
    );
    expect(call.args).toEqual(
      expect.arrayContaining([
        "--headless",
        "--norestore",
        "--nologo",
        "--nodefault",
        "--convert-to",
        "pdf",
      ]),
    );
    expect(call.args.at(-1)).toMatch(/\/in\/input\.pptx$/);
    expect(call.args.join(" ")).not.toMatch(/macro|vnd\.sun\.star\.script/i);
    // Minimal environment: nothing from the API process leaks in.
    expect(Object.keys(call.env ?? {}).sort()).toEqual([
      "HOME",
      "LANG",
      "PATH",
      "TMPDIR",
    ]);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("seeds the fresh profile with macros and untrusted links off", async () => {
    let profile = "";
    const spawner: RenderSpawner = (_command, args) => {
      const url = args[0].replace("-env:UserInstallation=file://", "");
      const child = new FakeProcess(1);
      void readFile(
        path.join(decodeURIComponent(url), "user", "registrymodifications.xcu"),
        "utf8",
      ).then((text) => {
        profile = text;
        child.emit("exit", 1, null);
      });
      return child;
    };
    await renderToPdf(Buffer.from("x"), "docx", {
      binary: "soffice",
      spawner,
      tempRoot,
    });
    expect(profile).toContain(
      `<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value>`,
    );
    expect(profile).toContain(
      `<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value>`,
    );
    expect(profile).toContain(
      `<prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value>`,
    );
  });

  it("kills the process group on timeout and still removes the temp directory", async () => {
    const calls: SpawnCall[] = [];
    const { spawner, last } = fakeSpawner({ hang: true }, calls);
    const killGroup = jest.fn((_pid: number, _signal: NodeJS.Signals) => {
      last()?.emit("exit", null, "SIGKILL");
    });
    const logger = recordingLogger();
    const result = await renderToPdf(Buffer.from("x"), "xlsx", {
      binary: "soffice",
      spawner,
      killGroup,
      tempRoot,
      timeoutMs: 30,
      logger,
    });
    expect(isRenderFailure(result) && result.code).toBe("timeout");
    expect(killGroup).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(await readdir(tempRoot)).toEqual([]);
    const failed = logger.entries.find(
      (entry) => entry.message === "grading.v3.render.failed",
    );
    expect(failed?.meta).toMatchObject({ code: "timeout", extension: "xlsx" });
  });

  it("reports a missing binary as unavailable, not a throw", async () => {
    const { spawner } = fakeSpawner({ error: "ENOENT" }, []);
    const result = await renderToPdf(Buffer.from("x"), "docx", {
      binary: "/nope/soffice",
      spawner,
      tempRoot,
    });
    expect(isRenderFailure(result) && result.code).toBe("unavailable");
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("fails on a non-zero exit, and when soffice exits 0 without a PDF", async () => {
    const crashed = await renderToPdf(Buffer.from("x"), "docx", {
      binary: "soffice",
      spawner: fakeSpawner({ code: 81 }, []).spawner,
      tempRoot,
    });
    expect(isRenderFailure(crashed) && crashed.code).toBe("failed");
    const empty = await renderToPdf(Buffer.from("x"), "docx", {
      binary: "soffice",
      spawner: fakeSpawner({ code: 0 }, []).spawner,
      tempRoot,
    });
    expect(isRenderFailure(empty) && empty.code).toBe("no_output");
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("refuses an oversized PDF", async () => {
    const result = await renderToPdf(Buffer.from("x"), "pptx", {
      binary: "soffice",
      spawner: fakeSpawner({ pdf: Buffer.alloc(2048) }, []).spawner,
      tempRoot,
      maxPdfBytes: 1024,
    });
    expect(isRenderFailure(result) && result.code).toBe("too_large");
  });

  it("does not run for macro-enabled or unknown formats", async () => {
    const calls: SpawnCall[] = [];
    const { spawner } = fakeSpawner({ pdf: Buffer.from("%PDF") }, calls);
    for (const extension of ["xlsm", "docm", "pptm", "odt", "../x"]) {
      const result = await renderToPdf(Buffer.from("x"), extension, {
        binary: "soffice",
        spawner,
        tempRoot,
      });
      expect(isRenderFailure(result) && result.code).toBe("unsupported");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("createRenderer", () => {
  it("is off when GRADING_V3_RENDER=off and on otherwise", () => {
    expect(
      createRenderer({ environment: { GRADING_V3_RENDER: "off" } }),
    ).toBeUndefined();
    expect(
      createRenderer({ environment: { GRADING_V3_RENDER: " OFF " } }),
    ).toBeUndefined();
    expect(createRenderer({ environment: {} })).toBeDefined();
    expect(
      createRenderer({ environment: { GRADING_V3_RENDER: "on" } }),
    ).toBeDefined();
  });

  it("warns once and fails fast when LibreOffice is missing", async () => {
    const logger = recordingLogger();
    const resolveBinary = jest.fn((): string | undefined => undefined);
    const render = jest.fn();
    const renderer = createRenderer({
      environment: {},
      logger,
      resolveBinary,
      render,
    });
    const first = await renderer?.toPdf(Buffer.from("x"), "pptx");
    const second = await renderer?.toPdf(Buffer.from("x"), "docx");
    expect(first && isRenderFailure(first) && first.code).toBe("unavailable");
    expect(second && isRenderFailure(second) && second.code).toBe(
      "unavailable",
    );
    expect(resolveBinary).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(
      logger.entries.filter((entry) => entry.level === "warn"),
    ).toHaveLength(1);
  });

  it("runs at most maxConcurrent conversions at once", async () => {
    let running = 0;
    let peak = 0;
    const render = jest.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return Buffer.from("%PDF");
    });
    const renderer = createRenderer({
      environment: {},
      maxConcurrent: 2,
      resolveBinary: () => "soffice",
      render,
    });
    await Promise.all(
      Array.from({ length: 5 }, () =>
        renderer?.toPdf(Buffer.from("x"), "pptx"),
      ),
    );
    expect(render).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });
});

describe("resolveSofficeBinary", () => {
  it("uses LIBREOFFICE_PATH only, and only when it is executable", () => {
    expect(
      resolveSofficeBinary({ LIBREOFFICE_PATH: "/definitely/not/soffice" }),
    ).toBeUndefined();
    expect(resolveSofficeBinary({ LIBREOFFICE_PATH: process.execPath })).toBe(
      process.execPath,
    );
  });
});

// ── real LibreOffice ────────────────────────────────────────────────────────

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

const binary = resolveSofficeBinary() ?? "";
// Skipped where LibreOffice is not installed.
const withSoffice = binary ? it : it.skip;

describe("renderToPdf with LibreOffice", () => {
  withSoffice(
    "renders a deck to one page per slide",
    async () => {
      const deck = await textDeck(["Findings", "Method", "Next steps"]);
      const pdf = await renderToPdf(deck, "pptx", { binary });
      if (isRenderFailure(pdf)) throw new Error(pdf.message);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pageCount(pdf)).toBe(3);
    },
    60_000,
  );

  withSoffice(
    "renders only the chart sheet of a long workbook, on one page",
    async () => {
      const prepared = await chartSheetsWorkbook(await chartWorkbook(1200));
      if (!prepared) throw new Error("no chart sheet found");
      const pdf = await renderToPdf(prepared.buffer, "xlsx", {
        binary,
      });
      if (isRenderFailure(pdf)) throw new Error(pdf.message);
      expect(pageCount(pdf)).toBe(1);
    },
    60_000,
  );

  withSoffice(
    "does not fetch a document's external linked image",
    async () => {
      const hits: string[] = [];
      const server: Server = createServer((request, response) => {
        hits.push(request.url ?? "");
        response.statusCode = 404;
        response.end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const { port } = server.address() as AddressInfo;
      try {
        const base = await JSZip.loadAsync(
          await textDocument(["linked image"]),
        );
        const documentXml =
          (await base.file("word/document.xml")?.async("string")) ?? "";
        base.file(
          "word/document.xml",
          documentXml
            .replace(
              "<w:document ",
              `<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" `,
            )
            .replace(
              "</w:body>",
              `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body>`,
            ),
        );
        base.file(
          "word/_rels/document.xml.rels",
          `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1:${port}/linked.png" TargetMode="External"/></Relationships>`,
        );
        const docx = await base.generateAsync({ type: "nodebuffer" });
        const pdf = await renderToPdf(docx, "docx", { binary });
        if (isRenderFailure(pdf)) throw new Error(pdf.message);
        expect(hits).toEqual([]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    },
    60_000,
  );
});
