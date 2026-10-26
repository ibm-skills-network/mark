/**
 * @jest-environment node
 */

import { translateQuestion } from "../shared";

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

describe("translateQuestion", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends only the language code, never the question or its answers", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        translatedQuestion: "Elige uno",
        translatedChoices: [{ id: 1, choice: "A" }],
      }),
    );

    const result = await translateQuestion(42, 7, "es");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/assignments\/42\/questions\/7\/translations$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      selectedLanguageCode: "es",
    });
    expect(result).toEqual({
      translatedQuestion: "Elige uno",
      translatedChoices: [{ id: 1, choice: "A" }],
    });
  });

  it.each([400, 429, 503])(
    "leaves the question untranslated on %i without throwing",
    async (status) => {
      fetchMock.mockResolvedValue(
        jsonResponse(status, { statusCode: status, message: "nope" }),
      );

      await expect(translateQuestion(42, 7, "es")).resolves.toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        "[learner] question left untranslated",
        expect.objectContaining({ questionId: 7, status }),
      );
    },
  );

  it("throws on other failures, with the server's message when it has one", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { statusCode: 404, message: "Question not found" }),
    );
    await expect(translateQuestion(42, 7, "es")).rejects.toThrow(
      "Question not found",
    );

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    await expect(translateQuestion(42, 7, "es")).rejects.toThrow(
      "Failed to translate question",
    );
  });
});
