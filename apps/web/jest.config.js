const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "node",
  testRegex: ".*\\.test\\.(ts|tsx|js|jsx)$",
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json", "node"],
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "!app/**/*.d.ts",
    "!app/**/*.stories.tsx",
    "!app/**/node_modules/**",
  ],
  coverageDirectory: "../coverage/web",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/app/$1",
  },
};

module.exports = createJestConfig(customJestConfig);
