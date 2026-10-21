import { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import { DataTransformInterceptor } from "./data-transform.interceptor";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

async function decodeBody(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const interceptor = new DataTransformInterceptor(reflector);
  const request: { body: Record<string, unknown>; query: object } = {
    body,
    query: {},
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(null) };
  await lastValueFrom(interceptor.intercept(context, next));
  return request.body;
}

describe("DataTransformInterceptor request decoding", () => {
  const notebookText = JSON.stringify({
    cells: [{ cell_type: "code", source: ["x = 1"] }],
    nbformat: 4,
  });

  it("keeps a learner file's content as the text that was sent", async () => {
    const body = await decodeBody({
      learnerFileResponse: [
        { filename: "lab.ipynb", content: b64(notebookText) },
      ],
    });

    const [file] = body.learnerFileResponse as { content: unknown }[];
    expect(file.content).toBe(notebookText);
  });

  it("keeps file content as text inside a full attempt submission", async () => {
    const body = await decodeBody({
      responsesForQuestions: [
        {
          id: 1,
          learnerFileResponse: [
            { filename: "data.json", content: b64("[1,2,3]") },
          ],
        },
      ],
    });

    const [response] = body.responsesForQuestions as {
      learnerFileResponse: { content: unknown }[];
    }[];
    expect(response.learnerFileResponse[0].content).toBe("[1,2,3]");
  });

  it("still decodes structured content outside learner files", async () => {
    const body = await decodeBody({ content: b64('{"a":1}') });
    expect(body.content).toEqual({ a: 1 });
  });
});
