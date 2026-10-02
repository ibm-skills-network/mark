import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../auth/interfaces/user.session.interface";
import { MessagingService } from "../messaging/messaging.service";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";

describe("ApiController", () => {
  let controller: ApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ConfigService,
        MessagingService,
        ApiService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}),
          } as Partial<Logger>,
        },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getUserSession", () => {
    it("returns the client fields and only the LMS host of the outcome URL", () => {
      const request = {
        userSession: {
          userId: "learner@example.com",
          role: UserRole.LEARNER,
          assignmentId: 2309,
          groupId: "course-group-1",
          gradingCallbackRequired: true,
          returnUrl: "",
          launch_presentation_locale: "en",
          sessionToken: "token",
          lisOutcomeServiceUrl:
            "https://courses.cognitiveclass.ai/courses/course-v1:IBM+CC0301EN+v1/outcome",
        },
      } as UserSessionRequest;

      expect(controller.getUserSession(request)).toEqual({
        userId: "learner@example.com",
        role: UserRole.LEARNER,
        assignmentId: 2309,
        returnUrl: "",
        launch_presentation_locale: "en",
        lmsHost: "courses.cognitiveclass.ai",
      });
    });

    it("rejects a request without a session", () => {
      expect(() => controller.getUserSession({} as UserSessionRequest)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
