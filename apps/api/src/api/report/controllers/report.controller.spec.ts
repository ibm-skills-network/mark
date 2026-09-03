import "reflect-metadata";
import { ReportsController } from "./report.controller";

const service = {
  reportIssue: jest.fn().mockResolvedValue({ message: "ok", reportId: 7 }),
  sendUserFeedback: jest.fn().mockResolvedValue({ message: "thanks" }),
};

const make = () => new ReportsController(service as never);

// The gateway decodes the launch JWT and hands the session to the API; only
// returnUrl matters here.
const req = (returnUrl?: string) =>
  ({
    userSession: {
      userId: "learner@example.com",
      role: "learner",
      assignmentId: 42,
      ...(returnUrl === undefined ? {} : { returnUrl }),
    },
  }) as never;

const dto = {
  issueType: "technical",
  description: "Submission fails",
};

describe("ReportsController.reportIssue", () => {
  beforeEach(() => jest.clearAllMocks());

  it("derives the portal from the session's LTI return URL", async () => {
    await make().reportIssue(
      dto as never,
      undefined as never,
      req("https://www.coursera.org/learn/ai-capstone/home"),
    );

    expect(service.reportIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        portal: {
          portalHost: "coursera.org",
          portalName: "Coursera",
          portalUrl: "https://www.coursera.org",
        },
      }),
      expect.anything(),
      undefined,
    );
  });

  it("passes a portal hostname through when it is not a known platform", async () => {
    await make().reportIssue(
      dto as never,
      undefined as never,
      req("https://blitzacademy.skillsnetwork.site/courses"),
    );

    const [sentDto] = service.reportIssue.mock.calls[0];
    expect(sentDto.portal).toMatchObject({
      portalHost: "blitzacademy.skillsnetwork.site",
      portalName: "blitzacademy.skillsnetwork.site",
      portalUrl: "https://blitzacademy.skillsnetwork.site",
    });
  });

  // A client could otherwise name any portal it liked and, once routing keys
  // off the portal, send its ticket to another product's queue.
  it("prefers the session over a client-supplied portal name", async () => {
    await make().reportIssue(
      { ...dto, portalName: "Cognitive Class" } as never,
      undefined as never,
      req("https://www.coursera.org/learn/x"),
    );

    const [sentDto] = service.reportIssue.mock.calls[0];
    expect(sentDto.portal.portalName).toBe("Coursera");
  });

  it("falls back to the client's portal name when the session has no return URL", async () => {
    await make().reportIssue(
      { ...dto, portalName: "Cognitive Class" } as never,
      undefined as never,
      req(),
    );

    const [sentDto] = service.reportIssue.mock.calls[0];
    expect(sentDto.portal.portalName).toBe("Cognitive Class");
    expect(sentDto.portal.portalUrl).toBeUndefined();
  });

  it("omits portal details entirely for a session without a return URL", async () => {
    await make().reportIssue(dto as never, undefined as never, req());

    const [sentDto] = service.reportIssue.mock.calls[0];
    expect(sentDto.portal.portalName).toBeUndefined();
    expect(sentDto.portal.portalUrl).toBeUndefined();
  });

  it("forwards the client's page URL and browser", async () => {
    await make().reportIssue(
      {
        ...dto,
        pageUrl: "https://mark.skills.network/learner/42/questions",
        browser: "Chrome 141 on macOS",
      } as never,
      undefined as never,
      req("https://cognitiveclass.ai/courses/ml"),
    );

    const [sentDto] = service.reportIssue.mock.calls[0];
    expect(sentDto.additionalDetails).toMatchObject({
      pageUrl: "https://mark.skills.network/learner/42/questions",
      browser: "Chrome 141 on macOS",
    });
  });
});

describe("ReportsController.sendUserFeedback", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends the session's portal with the feedback", async () => {
    await make().sendUserFeedback(
      { title: "Nice", description: "Worked well", rating: "5" } as never,
      req("https://cognitiveclass.ai/courses/ml"),
    );

    expect(service.sendUserFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        portalName: "cognitiveclass.ai",
        portalUrl: "https://cognitiveclass.ai",
      }),
    );
  });

  it("keeps the Mark default when there is no portal", async () => {
    await make().sendUserFeedback(
      { title: "Nice", description: "Worked well", rating: "5" } as never,
      req(),
    );

    expect(service.sendUserFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ portalName: "Mark AI Assistant" }),
    );
  });
});
