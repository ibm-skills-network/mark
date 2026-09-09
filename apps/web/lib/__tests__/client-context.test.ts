import { getClientContext } from "@/lib/client-context";

describe("getClientContext", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reports the current page and raw user agent", () => {
    expect(getClientContext()).toEqual({
      pageUrl: window.location.href,
      browser: navigator.userAgent,
    });
  });

  it("caps the user agent at the support API limit", () => {
    jest
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("x".repeat(501));
    expect(getClientContext().browser).toHaveLength(500);
  });

  it("never throws when the environment cannot be read", () => {
    jest.spyOn(window.navigator, "userAgent", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getClientContext()).toEqual({});
  });
});
