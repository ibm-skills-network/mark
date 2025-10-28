/* eslint-env node */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/../../app/$1",
    "^@config/(.*)$": "<rootDir>/../config/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  collectCoverageFrom: [
    "../**/*.ts",
    "!../**/*.d.ts",
    "!../**/*.test.ts",
    "!../**/node_modules/**",
  ],
  coverageReporters: ["text", "lcov", "html"],
  coverageDirectory: "<rootDir>/coverage",
};
