import type { Config } from "jest";

process.env.OPENAI_API_KEY = "dummy-key"; // pragma: allowlist secret
process.env.SENDGRID_API_KEY = "SG.test-key"; // pragma: allowlist secret

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts", "node"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: -10,
    },
  },
  clearMocks: true,
  testPathIgnorePatterns: ["<rootDir>/dist/"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  testEnvironment: "node",
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
    "^pdfjs-dist/legacy/build/pdf\\.mjs$":
      "<rootDir>/test/__mocks__/pdfjs-dist.ts",
  },
};

export default config;
