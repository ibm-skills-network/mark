import "reflect-metadata";
import { BaseAssignmentAttemptResponseDto } from "../dto/assignment-attempt/base.assignment.attempt.response.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "../dto/assignment-attempt/get.assignment.attempt.response.dto";
import { readServerClock } from "./server-clock.helper";

const swaggerProperties = (target: object): string[] =>
  (Reflect.getMetadata(
    "swagger/apiModelPropertiesArray",
    target,
  ) as string[]) ?? [];

describe("readServerClock", () => {
  it("returns the server's own clock as an ISO-8601 UTC instant", () => {
    const before = Date.now();
    const serverNow = readServerClock();
    const after = Date.now();

    expect(serverNow).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const parsed = Date.parse(serverNow);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("lets a caller derive the offset between its clock and the server's", () => {
    const deviceSkewMs = 10 * 60 * 1000;
    const serverNow = readServerClock();
    const deviceNow = Date.now() + deviceSkewMs;

    const offset = Date.parse(serverNow) - deviceNow;

    // Within a second of the true skew — the remainder is the call itself.
    expect(Math.abs(offset + deviceSkewMs)).toBeLessThan(1000);
  });
});

describe("attempt response contract", () => {
  it("documents serverNow on the attempt-creation response", () => {
    expect(
      swaggerProperties(BaseAssignmentAttemptResponseDto.prototype),
    ).toContain(":serverNow");
  });

  it("documents serverNow alongside expiresAt on the attempt response", () => {
    const properties = swaggerProperties(
      AssignmentAttemptResponseDto.prototype,
    );
    expect(properties).toContain(":expiresAt");
    expect(properties).toContain(":serverNow");
  });

  it("survives JSON serialization on the learner attempt payload", () => {
    const expiresAt = new Date("2026-09-12T12:20:00.000Z");
    const payload: Partial<GetAssignmentAttemptResponseDto> = {
      id: 2493,
      assignmentId: 3663,
      submitted: false,
      expiresAt,
      createdAt: new Date("2026-09-12T12:00:00.000Z"),
      serverNow: "2026-09-12T12:00:01.000Z",
    };

    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, string>;

    expect(wire.serverNow).toBe("2026-09-12T12:00:01.000Z");
    // The two fields must be comparable without any client-clock reading.
    expect(Date.parse(wire.expiresAt) - Date.parse(wire.serverNow)).toBe(
      20 * 60 * 1000 - 1000,
    );
  });
});
