/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";

/**
 * Creates a mock logger instance for testing
 */
export const createMockLogger = () => ({
  child: jest.fn().mockReturnValue({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
});

/**
 * Creates a basic mock of PrismaService for testing
 */
export const createMockPrismaService = () => ({
  assignment: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  assignmentGroup: {
    findMany: jest.fn(),
  },
  question: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
  questionVariant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  job: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  publishJob: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  translation: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  assignmentTranslation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  report: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback()),
});

/**
 * Mock auth middleware factory
 * @param role The user role to mock
 * @param userId The user ID to mock
 * @param groupId The group ID to mock
 */
export const createMockAuthMiddleware = (
  role: UserRole = UserRole.AUTHOR,
  userId = "user123",
  groupId = "string",
) => {
  return jest.fn().mockImplementation((request, _res, next) => {
    request.userSession = {
      userId,
      role,
      groupId,
    };
    request.cookies = {
      authentication: "mock.jwt.token",
    };
    next();
  });
};

/**
 * Creates mock user sessions for testing
 */
export const createMockUserSessions = () => {
  return {
    learner: {
      userId: "learner456",
      role: UserRole.LEARNER,
      groupId: "group1",
    } as UserSession,
    author: {
      userId: "author123",
      role: UserRole.AUTHOR,
      groupId: "group1",
    } as UserSession,
  };
};

/**
 * Utility to create a test module with common mocks
 * @param moduleMetadata The module metadata to merge with default mocks
 */
export const createTestingModule = async (moduleMetadata: any) => {
  const baseProviders = [
    {
      provide: WINSTON_MODULE_PROVIDER,
      useValue: createMockLogger(),
    },
  ];

  const moduleFixture: TestingModule = await Test.createTestingModule({
    ...moduleMetadata,
    providers: [...(moduleMetadata.providers || []), ...baseProviders],
  }).compile();

  return moduleFixture;
};

/**
 * Helper to initialize a NestJS application for e2e tests
 * @param moduleFixture The test module fixture
 * @param middleware Optional authentication middleware
 */
export const initializeApp = async (
  moduleFixture: TestingModule,
  middleware?: (req: any, res: any, next: any) => void,
): Promise<INestApplication> => {
  const app = moduleFixture.createNestApplication();

  if (middleware) {
    app.use(middleware);
  }

  await app.init();
  return app;
};

/**
 * Determines if LLM integration tests should be run based on environment variable
 */
export const shouldRunLlmTests = (): boolean => {
  return process.env.RUN_LLM_TESTS === "true";
};

/**
 * Conditionally executes a test based on whether LLM tests should be run
 * @param name The test name
 * @param testFn The test function
 * @param timeout Optional timeout
 */
export const llmTest = (name: string, testFn: () => void, timeout?: number) => {
  return shouldRunLlmTests()
    ? it(name, testFn, timeout)
    : it.skip(name, testFn);
};
