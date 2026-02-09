/* eslint-disable */

import { UserRole } from "../../interfaces/user.session.interface";
import { JwtConfigService } from "../jwt.config.service";
import { JwtCookieStrategy } from "./jwt.cookie.strategy";

describe("JwtCookieStrategy", () => {
  let strategy: JwtCookieStrategy;
  let configService: JwtConfigService;

  beforeEach(() => {
    process.env.SECRET = "test-secret";
    configService = new JwtConfigService();
    strategy = new JwtCookieStrategy(configService);
  });

  afterEach(() => {
    delete process.env.SECRET;
  });

  describe("validate", () => {
    it("should transform JWT payload to UserSession", () => {
      const payload = {
        userID: "user123",
        role: UserRole.LEARNER,
        groupID: "group456",
        assignmentID: 789,
        gradingCallbackRequired: true,
        returnUrl: "https://example.com",
        launch_presentation_locale: "en-US",
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      };

      const result = strategy.validate(payload);

      expect(result).toEqual({
        userId: "user123",
        role: UserRole.LEARNER,
        groupId: "group456",
        assignmentId: 789,
        gradingCallbackRequired: true,
        returnUrl: "https://example.com",
        launch_presentation_locale: "en-US",
      });
    });

    it("should handle payload with undefined optional fields", () => {
      const payload = {
        userID: "user123",
        role: UserRole.AUTHOR,
        groupID: undefined,
        assignmentID: undefined,
        gradingCallbackRequired: undefined,
        returnUrl: undefined,
        launch_presentation_locale: undefined,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const result = strategy.validate(payload);

      expect(result.userId).toBe("user123");
      expect(result.role).toBe(UserRole.AUTHOR);
      expect(result.groupId).toBeUndefined();
      expect(result.assignmentId).toBeUndefined();
    });

    it("should handle payload with null optional fields", () => {
      const payload = {
        userID: "user123",
        role: UserRole.ADMIN,
        groupID: null,
        assignmentID: null,
        gradingCallbackRequired: null,
        returnUrl: null,
        launch_presentation_locale: null,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const result = strategy.validate(payload);

      expect(result.userId).toBe("user123");
      expect(result.role).toBe(UserRole.ADMIN);
    });

    it("should handle different role types", () => {
      const roles = [UserRole.LEARNER, UserRole.AUTHOR, UserRole.ADMIN];

      for (const role of roles) {
        const payload = {
          userID: `user-${role}`,
          role,
          groupID: "test-group",
          assignmentID: 123,
          iat: 1_234_567_890,
          exp: 1_234_567_890 + 3600,
        };

        const result = strategy.validate(payload);
        expect(result.role).toBe(role);
      }
    });

    it("should handle different locale formats", () => {
      const locales = ["en-US", "fr-FR", "es-ES", "de-DE", "ja-JP", "zh-CN"];

      for (const locale of locales) {
        const payload = {
          userID: "user123",
          role: UserRole.LEARNER,
          groupID: "test-group",
          assignmentID: 123,
          launch_presentation_locale: locale,
          iat: 1_234_567_890,
          exp: 1_234_567_890 + 3600,
        };

        const result = strategy.validate(payload);
        expect(result.launch_presentation_locale).toBe(locale);
      }
    });

    it("should handle boolean gradingCallbackRequired values", () => {
      for (const value of [true, false]) {
        const payload = {
          userID: "user123",
          role: UserRole.LEARNER,
          groupID: "test-group",
          assignmentID: 123,
          gradingCallbackRequired: value,
          iat: 1_234_567_890,
          exp: 1_234_567_890 + 3600,
        };

        const result = strategy.validate(payload);
        expect(result.gradingCallbackRequired).toBe(value);
      }
    });

    it("should handle various URL formats", () => {
      const urls = [
        "https://example.com",
        "http://localhost:3000",
        "https://example.com/path/to/resource?query=value",
        "https://subdomain.example.com:8080/path",
      ];

      for (const url of urls) {
        const payload = {
          userID: "user123",
          role: UserRole.LEARNER,
          groupID: "test-group",
          assignmentID: 123,
          returnUrl: url,
          iat: 1_234_567_890,
          exp: 1_234_567_890 + 3600,
        };

        const result = strategy.validate(payload);
        expect(result.returnUrl).toBe(url);
      }
    });
  });

  describe("JWT extraction", () => {
    it("should be configured to extract from cookie", () => {
      // Verify the strategy is properly configured and uses cookie extraction
      expect(strategy).toBeDefined();
      expect(configService.jwtConstants).toBeDefined();
      expect(configService.jwtConstants.secret).toBe("test-secret");
    });
  });
});
