import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MAX_LEARNER_URL_LENGTH } from "src/api/attempt/common/utils/learner-url.util";
import { CreateQuestionResponseAttemptRequestDto } from "./create.question.response.attempt.request.dto";

async function errorsFor(
  learnerUrlResponse: unknown,
): Promise<Record<string, unknown>> {
  const dto = plainToInstance(CreateQuestionResponseAttemptRequestDto, {
    id: 1,
    language: "en",
    learnerUrlResponse,
  });
  const errors = await validate(dto, { whitelist: false });
  const urlError = errors.find(
    (error) => error.property === "learnerUrlResponse",
  );
  return urlError?.constraints ?? {};
}

describe("CreateQuestionResponseAttemptRequestDto — learnerUrlResponse", () => {
  it("accepts an ordinary link", async () => {
    expect(await errorsFor("https://github.com/owner/repo")).toEqual({});
  });

  it("accepts a schemeless link, leaving the shared helper to normalize it", async () => {
    // A stricter rule here (an @IsUrl-style check) would reject at the HTTP
    // boundary what the grader can read perfectly well once normalized, and
    // turn a gradeable answer into a 400.
    expect(await errorsFor("github.com/owner/repo/blob/main/a.js")).toEqual({});
  });

  it("accepts a link pasted with surrounding whitespace", async () => {
    expect(await errorsFor(" https://github.com/owner/repo \n")).toEqual({});
  });

  it("accepts an unparseable string so grading can explain it to the learner", async () => {
    expect(await errorsFor("dgtj")).toEqual({});
  });

  it("rejects a non-string payload", async () => {
    expect(Object.keys(await errorsFor(12_345))).toContain("isString");
    expect(Object.keys(await errorsFor({ url: "x" }))).toContain("isString");
    expect(Object.keys(await errorsFor(["https://a.example"]))).toContain(
      "isString",
    );
  });

  it("rejects an oversized payload", async () => {
    const oversized = `https://example.com/${"a".repeat(MAX_LEARNER_URL_LENGTH)}`;
    expect(Object.keys(await errorsFor(oversized))).toContain("maxLength");
  });

  it("still allows the field to be omitted entirely", async () => {
    const dto = plainToInstance(CreateQuestionResponseAttemptRequestDto, {
      id: 1,
      language: "en",
    });
    const errors = await validate(dto);
    expect(
      errors.some((error) => error.property === "learnerUrlResponse"),
    ).toBe(false);
  });
});
