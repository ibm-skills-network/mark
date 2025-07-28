# Knowledge Base Testing Documentation

This document provides comprehensive information about the testing strategy and implementation for the Knowledge Base project.

## Table of Contents

- [Overview](#overview)
- [Test Types](#test-types)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing New Tests](#writing-new-tests)
- [Mocking Strategy](#mocking-strategy)
- [LLM Integration Tests](#llm-integration-tests)

## Overview

The Knowledge Base project follows a comprehensive testing approach that includes:

- **Unit Tests**: Testing individual components in isolation with mocked dependencies
- **Integration Tests**: Testing multiple components working together
- **End-to-End Tests**: Testing complete user flows through the API

Tests are organized by component type (repositories, services, controllers) and use Jest as the test runner and assertion library.

## Test Types

### Unit Tests

Unit tests verify that individual components (functions, methods, classes) work correctly in isolation. Dependencies are mocked to focus testing on the specific unit's behavior.

Example location: `src/api/assignment/repositories/assignment.repository.spec.ts`

### Integration Tests

Integration tests verify that multiple components work correctly together. These tests use partial mocking to test real interactions between selected components.

Example location: `src/api/assignment/tests/assignment.integration.spec.ts`

### End-to-End Tests

End-to-End (E2E) tests verify complete user flows through the API. These tests use a test database and real service implementations to validate the entire system.

## Test Structure

Tests are organized according to the following structure:

```
src/
├── api/
│   ├── assignment/
│   │   ├── controllers/
│   │   │   ├── assignment.controller.ts
│   │   │   └── assignment.controller.spec.ts
│   │   ├── repositories/
│   │   │   ├── assignment.repository.ts
│   │   │   └── assignment.repository.spec.ts
│   │   ├── services/
│   │   │   ├── assignment.service.ts
│   │   │   └── assignment.service.spec.ts
│   │   └── tests/
│   │       └── assignment.integration.spec.ts
│   └── ...
└── test/
    ├── test-utils.ts
    └── ...
```

Each component has a corresponding spec file in the same directory, with the exception of integration tests which are located in a dedicated `tests` directory.

## Running Tests

### Basic Test Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:cov

# Run tests in watch mode (for development)
npm run test:watch
```

### Running Specific Tests

```bash
# Run specific test file
npm test -- src/api/assignment/repositories/assignment.repository.spec.ts

# Run tests matching a pattern
npm test -- -t "Assignment Repository"
```

### Running E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific E2E test
npm run test:e2e -- src/api/assignment/tests/assignment.integration.spec.ts
```

### LLM Integration Tests

By default, tests that require the Language Learning Model (LLM) API are skipped. To run these tests, set the `RUN_LLM_TESTS` environment variable:

```bash
# Run tests including LLM integration tests
RUN_LLM_TESTS=true npm test
```

## Writing New Tests

### Test File Naming Conventions

- Unit tests: `[component-name].spec.ts`
- Integration tests: `[module-name].integration.spec.ts`
- E2E tests: `[feature-name].e2e-spec.ts`

### Test Structure Template

```typescript
// Import required modules
import { Test, TestingModule } from "@nestjs/testing";
import { DependencyService } from "../dependency.service";
import { ComponentToTest } from "./component-to-test";

describe("ComponentToTest", () => {
  let component: ComponentToTest;
  let dependencyService: DependencyService;

  // Setup before each test
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComponentToTest,
        {
          provide: DependencyService,
          useValue: {
            mockMethod: jest.fn(),
          },
        },
      ],
    }).compile();

    component = module.get<ComponentToTest>(ComponentToTest);
    dependencyService = module.get<DependencyService>(DependencyService);
  });

  // Clear mocks after each test
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test cases
  it("should be defined", () => {
    expect(component).toBeDefined();
  });

  describe("methodName", () => {
    it("should do something expected", async () => {
      // Arrange
      jest
        .spyOn(dependencyService, "mockMethod")
        .mockResolvedValue(expectedValue);

      // Act
      const result = await component.methodName(testInput);

      // Assert
      expect(result).toEqual(expectedOutput);
      expect(dependencyService.mockMethod).toHaveBeenCalledWith(expectedParams);
    });
  });
});
```

### Using Test Utilities

The project provides test utilities to simplify common testing tasks:

```typescript
import {
  createMockAuthMiddleware,
  createMockLogger,
  createMockPrismaService,
  createMockUserSessions,
  llmTest,
} from "src/test/test-utils";

// Create a mock logger
const logger = createMockLogger();

// Create a mock Prisma service with default mock implementations
const prismaService = createMockPrismaService();

// Create an auth middleware for API tests
const authMiddleware = createMockAuthMiddleware(
  UserRole.AUTHOR,
  "user123",
  "group1",
);

// Create mock user sessions for both author and learner roles
const { author, learner } = createMockUserSessions();

// Conditionally run LLM tests (skipped by default)
llmTest(
  "should work with real LLM",
  async () => {
    // This test only runs when RUN_LLM_TESTS=true
    // ...
  },
  30000,
); // Extended timeout for LLM calls
```

## Mocking Strategy

### Repository Mocking

Repositories should be mocked to avoid actual database calls during testing:

```typescript
// Mock the repository
const mockRepository = {
  findById: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// Configure the mock for a specific test
jest.spyOn(mockRepository, "findById").mockResolvedValue({
  id: 1,
  name: "Test Item",
});
```

### Service Mocking

Services should be mocked when testing controllers or other services:

```typescript
// Mock the service
const mockService = {
  getItem: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
};

// Configure the mock for a specific test
jest.spyOn(mockService, "getItem").mockResolvedValue({
  id: 1,
  name: "Test Item",
});
```

### LLM Service Mocking

The LLM service should always be mocked except in specific LLM integration tests:

```typescript
// Mock the LLM service
const mockLlmService = {
  generateQuestionRewordings: jest.fn().mockResolvedValue([
    { id: 101, variantContent: "Variant 1" /* ... */ },
    { id: 102, variantContent: "Variant 2" /* ... */ },
  ]),
  applyGuardRails: jest.fn().mockResolvedValue(true),
  translateText: jest
    .fn()
    .mockImplementation((text) => Promise.resolve(`Translated: ${text}`)),
};
```

### Prisma Service Mocking

The Prisma service should be mocked to avoid database connections:

```typescript
// Manual mock
const mockPrismaService = {
  assignment: {
    findUnique: jest.fn().mockResolvedValue({ id: 1, name: "Test Assignment" }),
    create: jest.fn().mockImplementation((data) => ({ id: 1, ...data.data })),
    // ...
  },
  question: {
    // ...
  },
  // ...
};

// Or use the utility
const mockPrismaService = createMockPrismaService();
```

## LLM Integration Tests

The project includes special utilities for testing with the real LLM integration. These tests are skipped by default and only run when the `RUN_LLM_TESTS` environment variable is set to `true`.

### When to Write LLM Tests

Write LLM integration tests for:

1. Critical features that depend on LLM output quality
2. Edge cases in prompt handling
3. Validating the format of LLM responses

### LLM Test Guidelines

1. Always use the `llmTest` helper to make these tests conditional
2. Set a longer timeout (at least 20-30 seconds) for LLM API calls
3. Keep these tests focused and minimal to reduce costs
4. Include fallback assertions for when the test is skipped

Example:

```typescript
import { llmTest, shouldRunLlmTests } from "src/test/test-utils";

describe("LLM Integration", () => {
  // This test only runs when RUN_LLM_TESTS=true
  llmTest(
    "should generate variants with real LLM",
    async () => {
      // Skip this test explicitly if not running LLM tests
      if (!shouldRunLlmTests()) {
        return;
      }

      // Restore the real LLM implementation for this test
      jest.spyOn(llmService, "generateVariants").mockRestore();

      // Test with the real LLM service
      const result = await service.generateVariants(
        "What is the capital of France?",
        1,
      );

      // Assert on general structure but be flexible on exact content
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("variantContent");
      expect(typeof result[0].variantContent).toBe("string");
      expect(result[0].variantContent.length).toBeGreaterThan(10);
    },
    30000,
  ); // Extended timeout
});
```

## Test Coverage Requirements

The project aims for the following test coverage targets:

- Overall code coverage: ≥ 80%
- Repository layer: ≥ 90%
- Service layer: ≥ 85%
- Controller layer: ≥ 80%
- Utility functions: ≥ 90%

Coverage reports can be generated with:

```bash
npm run test:cov
```

## Debugging Tests

To debug tests in VS Code:

1. Create a launch configuration in `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Jest Tests",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--testPathPattern=${fileBasename}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

2. Open the test file you want to debug
3. Set breakpoints in the code
4. Press F5 or select "Debug Jest Tests" from the debug menu

### Console Output

To see console output during tests:

```typescript
// Add this at the top of your test file
// @ts-ignore
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

// Then in your test
it("should log something", () => {
  // Act
  yourFunction();

  // Assert
  expect(console.log).toHaveBeenCalledWith("Expected message");
});
```

## Common Testing Patterns

### Testing Asynchronous Code

```typescript
it("should handle async operations", async () => {
  // Arrange
  jest.spyOn(service, "asyncMethod").mockResolvedValue(expectedResult);

  // Act
  const result = await controller.method();

  // Assert
  expect(result).toEqual(expectedResult);
});

it("should handle async errors", async () => {
  // Arrange
  const error = new Error("Test error");
  jest.spyOn(service, "asyncMethod").mockRejectedValue(error);

  // Act & Assert
  await expect(controller.method()).rejects.toThrow("Test error");
});
```

### Testing Observables (RxJS)

```typescript
import { firstValueFrom, of, throwError } from "rxjs";

it("should handle observables", async () => {
  // Arrange
  jest.spyOn(service, "observableMethod").mockReturnValue(of(expectedResult));

  // Act
  const result = await firstValueFrom(controller.method());

  // Assert
  expect(result).toEqual(expectedResult);
});

it("should handle observable errors", async () => {
  // Arrange
  const error = new Error("Test error");
  jest
    .spyOn(service, "observableMethod")
    .mockReturnValue(throwError(() => error));

  // Act & Assert
  await expect(firstValueFrom(controller.method())).rejects.toThrow(
    "Test error",
  );
});
```

### Testing Private Methods

```typescript
it("should test a private method", () => {
  // Access the private method through type casting
  const privateMethod = (service as any).privateMethod.bind(service);

  // Act
  const result = privateMethod(testInput);

  // Assert
  expect(result).toEqual(expectedOutput);
});
```

## Continuous Integration

Tests are run automatically in the CI pipeline for every pull request and push to main branches. The pipeline will fail if:

1. Any tests fail
2. Code coverage drops below the required thresholds
3. Linting issues are detected

Refer to the CI configuration files for specific settings and requirements.

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [Mock Functions (Jest)](https://jestjs.io/docs/mock-functions)
- [Testing Asynchronous Code (Jest)](https://jestjs.io/docs/asynchronous)
