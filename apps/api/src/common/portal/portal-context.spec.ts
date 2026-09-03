import { derivePortalContext } from "./portal-context";

describe("derivePortalContext", () => {
  it.each([
    [
      "https://www.coursera.org/learn/ai-capstone/home/module/3",
      "coursera.org",
      "Coursera",
      "https://www.coursera.org",
    ],
    [
      "https://learning.edx.org/course/course-v1:IBM+DS0101EN+3T2023/home",
      "learning.edx.org",
      "edX",
      "https://learning.edx.org",
    ],
    [
      "https://author.skills.network/courses/1234",
      "author.skills.network",
      "Faculty",
      "https://author.skills.network",
    ],
    [
      "https://cognitiveclass.ai/courses/machine-learning-with-python",
      "cognitiveclass.ai",
      "cognitiveclass.ai",
      "https://cognitiveclass.ai",
    ],
    [
      "https://blitzacademy.skillsnetwork.site/",
      "blitzacademy.skillsnetwork.site",
      "blitzacademy.skillsnetwork.site",
      "https://blitzacademy.skillsnetwork.site",
    ],
    [
      "https://skills.network",
      "skills.network",
      "skills.network",
      "https://skills.network",
    ],
  ])(
    "derives host, name and origin from %s",
    (returnUrl, portalHost, portalName, portalUrl) => {
      expect(derivePortalContext({ returnUrl })).toEqual({
        portalHost,
        portalName,
        portalUrl,
      });
    },
  );

  // A hostname suffix does not decide the product: courses.lpu.cognitiveclass.ai
  // is an India-academic portal. Naming it after its suffix would be a wrong
  // answer dressed as a right one, so the host is passed through untouched and
  // portal-manager gets the final say.
  it("does not label a portal that merely sits on a platform domain", () => {
    expect(
      derivePortalContext({
        returnUrl: "https://courses.lpu.cognitiveclass.ai/dashboard",
      }),
    ).toEqual({
      portalHost: "courses.lpu.cognitiveclass.ai",
      portalName: "courses.lpu.cognitiveclass.ai",
      portalUrl: "https://courses.lpu.cognitiveclass.ai",
    });
  });

  it("matches a platform on any of its subdomains", () => {
    expect(
      derivePortalContext({ returnUrl: "https://courses.edx.org/x" }),
    ).toEqual({
      portalHost: "courses.edx.org",
      portalName: "edX",
      portalUrl: "https://courses.edx.org",
    });
  });

  it.each([
    ["a missing session", undefined],
    ["a session without a return URL", {}],
    ["an empty return URL", { returnUrl: "   " }],
    ["a value that is not a URL", { returnUrl: "not-a-url" }],
    ["a non-http scheme", { returnUrl: "javascript:alert(1)" }],
    ["a file URL", { returnUrl: "file:///etc/passwd" }],
  ])("returns an empty context for %s", (_label, session) => {
    expect(derivePortalContext(session)).toEqual({});
  });

  it("never throws on a malformed claim", () => {
    expect(() =>
      derivePortalContext({ returnUrl: "http://[::1" }),
    ).not.toThrow();
  });
});
