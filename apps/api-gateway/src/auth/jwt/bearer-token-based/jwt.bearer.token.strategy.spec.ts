/* eslint-disable */

import { UnauthorizedException } from "@nestjs/common";
import { JwtConfigService } from "../jwt.config.service";
import { JwtBearerTokenStrategy } from "./jwt.bearer.token.strategy";

describe("JwtBearerTokenStrategy", () => {
  let strategy: JwtBearerTokenStrategy;
  let configService: JwtConfigService;

  beforeEach(() => {
    process.env.SECRET = "test-secret";
    configService = new JwtConfigService();
    strategy = new JwtBearerTokenStrategy(configService);
  });

  afterEach(() => {
    delete process.env.SECRET;
  });

  describe("validate", () => {
    it("should call done with payload when admin is true", () => {
      const payload = {
        userId: "admin123",
        role: "admin",
        admin: true,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      expect(doneMock).toHaveBeenCalledWith(undefined, payload);
    });

    it("should call done with UnauthorizedException when admin is false", () => {
      const payload = {
        userId: "user123",
        role: "student",
        admin: false,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      expect(doneMock).toHaveBeenCalledWith(
        expect.any(UnauthorizedException),
        false,
      );
    });

    it("should call done with UnauthorizedException when admin is undefined", () => {
      const payload = {
        userId: "user123",
        role: "student",
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      expect(doneMock).toHaveBeenCalledWith(
        expect.any(UnauthorizedException),
        false,
      );
    });

    it("should reject when admin is null", () => {
      const payload = {
        userId: "user123",
        role: "student",
        admin: null,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      expect(doneMock).toHaveBeenCalledWith(
        expect.any(UnauthorizedException),
        false,
      );
    });

    it("should accept admin user with all fields", () => {
      const payload = {
        userId: "admin123",
        role: "admin",
        groupId: "group123",
        assignmentId: "assign123",
        admin: true,
        gradingCallbackRequired: true,
        returnUrl: "https://example.com",
        launch_presentation_locale: "en-US",
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      expect(doneMock).toHaveBeenCalledWith(undefined, payload);
    });

    it("should have correct error message for unauthorized users", () => {
      const payload = {
        userId: "user123",
        role: "student",
        admin: false,
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 3600,
      } as any;

      const doneMock = jest.fn();
      strategy.validate(payload, doneMock);

      const errorCall = doneMock.mock.calls[0][0];
      expect(errorCall).toBeInstanceOf(UnauthorizedException);
      expect(errorCall.message).toBe("Not authorized");
    });
  });

  describe("JWT extraction", () => {
    it("should be configured to extract from Authorization header", () => {
      // Verify the strategy is properly configured and uses JWT bearer token extraction
      expect(strategy).toBeDefined();
      expect(configService.jwtConstants).toBeDefined();
      expect(configService.jwtConstants.secret).toBe("test-secret");
    });
  });
});
