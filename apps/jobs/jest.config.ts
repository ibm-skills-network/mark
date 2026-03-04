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
  clearMocks: true,
  testPathIgnorePatterns: ["<rootDir>/dist/"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  testEnvironment: "node",
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/../api/src/$1",
    "^pdfjs-dist/legacy/build/pdf\\.mjs$":
      "<rootDir>/../api/test/__mocks__/pdfjs-dist.ts",
  },
};

export default config;
