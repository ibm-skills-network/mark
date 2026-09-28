/**
 * @jest-environment jsdom
 */

import { reportClientError } from "../report-client-error";

describe("reportClientError", () => {
  afterEach(() => {
    delete window.ineum;
  });

  it("reports the error through the Instana agent", () => {
    const ineum = jest.fn();
    window.ineum = ineum;

    const error = new Error("could not parse stored content");
    reportClientError(error, { component: "RichTextEditor" });

    expect(ineum).toHaveBeenCalledWith("reportError", error, {
      meta: { component: "RichTextEditor" },
    });
  });

  it("wraps a thrown non-Error so the agent still gets a stack", () => {
    const ineum = jest.fn();
    window.ineum = ineum;

    reportClientError("plain string failure");

    const [, reported] = ineum.mock.calls[0] as [string, Error];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("plain string failure");
  });

  it("does nothing when the agent is absent, which is every non-prod build", () => {
    expect(() => reportClientError(new Error("boom"))).not.toThrow();
  });

  it("swallows a failure inside the agent rather than becoming one", () => {
    window.ineum = jest.fn(() => {
      throw new Error("blocked by an extension");
    });

    expect(() => reportClientError(new Error("boom"))).not.toThrow();
  });
});
