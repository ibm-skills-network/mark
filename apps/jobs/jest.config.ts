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
  // The jobs app imports the api package's modules via relative paths
  // (apps/jobs/src/app.module.ts -> ../../api/src/...). Those api modules
  // in turn use absolute imports of the form `src/foo/bar`, which resolve
  // at type-check time via apps/jobs/tsconfig.json `paths` and at api's
  // own jest run via apps/api/jest.config.ts `moduleNameMapper`. When jest
  // runs from this workspace, neither of those is consulted — without the
  // mapping below, transitively imported api files fail with
  // "Cannot find module 'src/...'". Map the same prefix to api's src/.
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/../api/src/$1",
    "^pdfjs-dist/legacy/build/pdf\\.mjs$":
      "<rootDir>/../api/test/__mocks__/pdfjs-dist.ts",
    // ibm-cloud-sdk-core (transitive via @ibm-cloud/watsonx-ai used in
    // SharedModule -> LlmModule) eagerly `require`s `file-type`, which is
    // ESM-only in v21+. Stub it for tests that only need DI resolution.
    "^file-type$": "<rootDir>/test/__mocks__/file-type.ts",
  },
};

export default config;
