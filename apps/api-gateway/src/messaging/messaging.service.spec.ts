/* eslint-disable */

import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { MessagingClient } from "sn-messaging-ts-client";
import { MessagingService } from "./messaging.service";

jest.mock("sn-messaging-ts-client");

describe("MessagingService", () => {
  let service: MessagingService;
  let configService: ConfigService;
  let mockMessagingClient: jest.Mocked<MessagingClient>;

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    mockMessagingClient = {
      publishService: jest.fn().mockResolvedValue({}),
      publishUser: jest.fn().mockResolvedValue({}),
      subscribeService: jest.fn().mockResolvedValue({}),
      subscribeUser: jest.fn().mockResolvedValue({}),
    } as any;

    (MessagingClient as jest.Mock).mockImplementation(
      () => mockMessagingClient,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                NATS_URL: "nats://test.example.com:4222",
                NATS_USERNAME: "test-user",
                NATS_PASSWORD: "test-password",
                NATS_ORGANIZATION: "test-org",
                NATS_PROGRAM: "test-program",
                NATS_PROJECT: "test-project",
              };
              return config[key];
            }),
          },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("onModuleInit", () => {
    it("should initialize MessagingClient with configuration", () => {
      service.onModuleInit();

      expect(MessagingClient).toHaveBeenCalledWith({
        user: "test-user",
        pass: "test-password",
        url: "nats://test.example.com:4222",
        tls: true,
        organization: "test-org",
        program: "test-program",
        project: "test-project",
      });
    });

    it("should read NATS_URL from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_URL");
    });

    it("should read NATS_USERNAME from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_USERNAME");
    });

    it("should read NATS_PASSWORD from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_PASSWORD");
    });

    it("should read NATS_ORGANIZATION from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_ORGANIZATION");
    });

    it("should read NATS_PROGRAM from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_PROGRAM");
    });

    it("should read NATS_PROJECT from config", () => {
      service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith("NATS_PROJECT");
    });

    it("should set tls to true", () => {
      service.onModuleInit();

      const callArguments = (MessagingClient as jest.Mock).mock.calls[0][0];
      expect(callArguments.tls).toBe(true);
    });
  });

  describe("onApplicationBootstrap", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should publish start message on bootstrap", () => {
      service.onApplicationBootstrap();

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        "start",
        {},
      );
    });

    it("should not throw error when publishService is called", () => {
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });
  });

  describe("publishService", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should call client.publishService with action and message", async () => {
      const action = "test-action";
      const message = { data: "test-data" };

      await service.publishService(action, message);

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        action,
        message,
      );
    });

    it("should return the result from client.publishService", async () => {
      const expectedResult = { success: true };
      mockMessagingClient.publishService.mockResolvedValue(expectedResult);

      const result = await service.publishService("action", {});

      expect(result).toEqual(expectedResult);
    });

    it("should handle string messages", async () => {
      await service.publishService("action", "string message");

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        "action",
        "string message",
      );
    });

    it("should handle number messages", async () => {
      await service.publishService("action", 123);

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        "action",
        123,
      );
    });

    it("should handle array messages", async () => {
      const arrayMessage = [1, 2, 3];
      await service.publishService("action", arrayMessage);

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        "action",
        arrayMessage,
      );
    });

    it("should handle complex object messages", async () => {
      const complexMessage = {
        nested: {
          data: "value",
          count: 42,
        },
        array: [1, 2, 3],
      };
      await service.publishService("action", complexMessage);

      expect(mockMessagingClient.publishService).toHaveBeenCalledWith(
        "action",
        complexMessage,
      );
    });
  });

  describe("publishUser", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should call client.publishUser with username, subject, and message", async () => {
      const username = "testuser";
      const subject = "test-subject";
      const message = { data: "test-data" };

      await service.publishUser(username, subject, message);

      expect(mockMessagingClient.publishUser).toHaveBeenCalledWith(
        username,
        subject,
        message,
      );
    });

    it("should return the result from client.publishUser", async () => {
      const expectedResult = { messageId: "msg-123" };
      mockMessagingClient.publishUser.mockResolvedValue(expectedResult);

      const result = await service.publishUser("user", "subject", {});

      expect(result).toEqual(expectedResult);
    });

    it("should handle different usernames", async () => {
      const usernames = ["user1", "user2@example.com", "user_with_underscore"];

      for (const username of usernames) {
        await service.publishUser(username, "subject", {});
        expect(mockMessagingClient.publishUser).toHaveBeenCalledWith(
          username,
          "subject",
          {},
        );
      }
    });

    it("should handle different subjects", async () => {
      const subjects = ["update", "notification", "alert.critical"];

      for (const subject of subjects) {
        await service.publishUser("user", subject, {});
        expect(mockMessagingClient.publishUser).toHaveBeenCalledWith(
          "user",
          subject,
          {},
        );
      }
    });

    it("should handle various message types", async () => {
      await service.publishUser("user", "subject", "string");
      await service.publishUser("user", "subject", 456);
      await service.publishUser("user", "subject", { key: "value" });

      expect(mockMessagingClient.publishUser).toHaveBeenCalledTimes(3);
    });
  });

  describe("subscribeService", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should call client.subscribeService with project and callbacks", async () => {
      const project = "test-project";
      const messageCallback = jest.fn();
      const errorCallback = jest.fn();

      await service.subscribeService(project, messageCallback, errorCallback);

      expect(mockMessagingClient.subscribeService).toHaveBeenCalledWith(
        project,
        messageCallback,
        undefined,
        expect.any(Function),
      );
    });

    it("should return the result from client.subscribeService", async () => {
      const expectedResult = { subscriptionId: "sub-123" };
      mockMessagingClient.subscribeService.mockResolvedValue(expectedResult);

      const result = await service.subscribeService(
        "project",
        jest.fn(),
        jest.fn(),
      );

      expect(result).toEqual(expectedResult);
    });

    it("should pass undefined as third parameter to client", async () => {
      const messageCallback = jest.fn();
      const errorCallback = jest.fn();

      await service.subscribeService("project", messageCallback, errorCallback);

      const callArguments = mockMessagingClient.subscribeService.mock.calls[0];
      expect(callArguments[2]).toBeUndefined();
    });

    it("should handle different project names", async () => {
      const projects = ["project-1", "project-2", "special.project"];

      for (const project of projects) {
        await service.subscribeService(project, jest.fn(), jest.fn());
        expect(mockMessagingClient.subscribeService).toHaveBeenCalledWith(
          project,
          expect.any(Function),
          undefined,
          expect.any(Function),
        );
      }
    });
  });

  describe("subscribeUser", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should call client.subscribeUser with username and callbacks", async () => {
      const username = "testuser";
      const messageCallback = jest.fn();
      const errorCallback = jest.fn();

      await service.subscribeUser(username, messageCallback, errorCallback);

      expect(mockMessagingClient.subscribeUser).toHaveBeenCalledWith(
        username,
        messageCallback,
        expect.any(Function),
      );
    });

    it("should return the result from client.subscribeUser", async () => {
      const expectedResult = { subscriptionId: "user-sub-123" };
      mockMessagingClient.subscribeUser.mockResolvedValue(expectedResult);

      const result = await service.subscribeUser("user", jest.fn(), jest.fn());

      expect(result).toEqual(expectedResult);
    });

    it("should handle different usernames", async () => {
      const usernames = ["user1", "user2@example.com", "user_with_underscore"];

      for (const username of usernames) {
        await service.subscribeUser(username, jest.fn(), jest.fn());
        expect(mockMessagingClient.subscribeUser).toHaveBeenCalledWith(
          username,
          expect.any(Function),
          expect.any(Function),
        );
      }
    });

    it("should pass message callback as second parameter", async () => {
      const messageCallback = jest.fn();
      await service.subscribeUser("user", messageCallback, jest.fn());

      const callArguments = mockMessagingClient.subscribeUser.mock.calls[0];
      expect(callArguments[1]).toBe(messageCallback);
    });

    it("should pass error callback as third parameter", async () => {
      const errorCallback = jest.fn();
      await service.subscribeUser("user", jest.fn(), errorCallback);

      const callArguments = mockMessagingClient.subscribeUser.mock.calls[0];
      expect(callArguments[2]).toEqual(expect.any(Function));
      const wrappedError = callArguments[2] as (error: Error) => void;
      const boom = new Error("boom");
      wrappedError(boom);
      expect(errorCallback).toHaveBeenCalledWith(boom);
    });
  });
});
