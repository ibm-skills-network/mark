import { deriveLmsHost, derivePortalContext } from "./portal-context";

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

  // Open edX portals send launch_presentation_return_url empty and Coursera
  // omits it, so without this fallback the majority of real launches have no
  // portal identity and their tickets cannot be routed.
  describe("falling back to the grade-callback host", () => {
    it.each([
      [
        "an empty return URL (Open edX)",
        {
          returnUrl: "",
          lisOutcomeServiceUrl:
            "http://courses.yl.skillsnetwork.site/courses/course-v1:Org+X+v1/xblock/block-v1/handler_noauth/outcome_service_handler",
        },
        "courses.yl.skillsnetwork.site",
        "courses.yl.skillsnetwork.site",
      ],
      [
        "an absent return URL (Coursera)",
        {
          lisOutcomeServiceUrl:
            "https://api.coursera.org/api/onDemandLtiOutcomes.v1",
        },
        "api.coursera.org",
        "Coursera",
      ],
      [
        "an absent return URL (Cognitive Class)",
        {
          lisOutcomeServiceUrl:
            "https://courses.cognitiveclass.ai/courses/x/handler_noauth/outcome_service_handler",
        },
        "courses.cognitiveclass.ai",
        "courses.cognitiveclass.ai",
      ],
    ])("derives the host from %s", (_label, session, host, name) => {
      expect(derivePortalContext(session)).toEqual({
        portalHost: host,
        portalName: name,
        // A grade-posting endpoint is not a page, so it never becomes portalUrl.
        portalUrl: undefined,
      });
    });

    it("prefers the return URL when both are present", () => {
      expect(
        derivePortalContext({
          returnUrl: "https://learn.ibm.com/mod/lti/return.php?course=1",
          lisOutcomeServiceUrl:
            "https://api.coursera.org/api/onDemandLtiOutcomes.v1",
        }),
      ).toEqual({
        portalHost: "learn.ibm.com",
        portalName: "learn.ibm.com",
        portalUrl: "https://learn.ibm.com",
      });
    });

    it.each([
      ["neither claim", {}],
      ["both empty", { returnUrl: "  ", lisOutcomeServiceUrl: "  " }],
      ["a malformed callback URL", { lisOutcomeServiceUrl: "not-a-url" }],
      [
        "a non-http callback scheme",
        { lisOutcomeServiceUrl: "javascript:alert(1)" },
      ],
    ])("returns an empty context for %s", (_label, session) => {
      expect(derivePortalContext(session)).toEqual({});
    });

    // A malformed returnUrl must not swallow a usable callback host.
    it("falls through when the return URL is unusable", () => {
      expect(
        derivePortalContext({
          returnUrl: "javascript:alert(1)",
          lisOutcomeServiceUrl:
            "https://api.coursera.org/api/onDemandLtiOutcomes.v1",
        }),
      ).toMatchObject({
        portalHost: "api.coursera.org",
        portalName: "Coursera",
      });
    });

    it.each([42, true, {}, ["https://api.coursera.org/outcome"]])(
      "ignores non-string claims (%j) without losing a usable fallback",
      (value) => {
        expect(derivePortalContext({ lisOutcomeServiceUrl: value })).toEqual(
          {},
        );
        expect(
          derivePortalContext({
            returnUrl: value,
            lisOutcomeServiceUrl: "https://api.coursera.org/outcome",
          }),
        ).toMatchObject({ portalHost: "api.coursera.org" });
      },
    );
  });
});

describe("deriveLmsHost", () => {
  it("returns the normalized host of the outcome service URL", () => {
    expect(
      deriveLmsHost({
        lisOutcomeServiceUrl:
          "https://Courses.CognitiveClass.ai/courses/course-v1:IBM+CC0301EN+v1/xblock/outcome",
      }),
    ).toBe("courses.cognitiveclass.ai");
  });

  it.each([
    ["no session", undefined],
    ["no outcome URL", {}],
    ["a malformed URL", { lisOutcomeServiceUrl: "http://[::1" }],
    ["an array claim", { lisOutcomeServiceUrl: ["https://a.example"] }],
    ["a number claim", { lisOutcomeServiceUrl: 42 }],
  ])("returns undefined for %s", (_label, session) => {
    expect(deriveLmsHost(session)).toBeUndefined();
  });
});
