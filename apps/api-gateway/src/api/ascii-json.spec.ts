import * as http from "node:http";
import { asciiJson } from "./api.service";

describe("asciiJson", () => {
  const session = {
    userId: "learner@example.com",
    courseTitle: "Introducción a la IA · 인공지능 😀",
  };

  it("produces a value Node accepts as an HTTP header", () => {
    expect(() => {
      http.validateHeaderValue("user-session", asciiJson(session));
    }).not.toThrow();
    expect(() => {
      http.validateHeaderValue("user-session", JSON.stringify(session));
    }).toThrow();
  });

  it("parses back to the same value", () => {
    expect(JSON.parse(asciiJson(session))).toEqual(session);
  });
});
