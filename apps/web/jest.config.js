const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jsdom",
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
    "^@/stores/(.*)$": "<rootDir>/stores/$1",
    "^@/components/(.*)$": "<rootDir>/components/$1",
    "^@/config/(.*)$": "<rootDir>/config/$1",
    "^@/lib/(.*)$": "<rootDir>/lib/$1",
    "^@/(.*)$": "<rootDir>/app/$1",
  },
};

module.exports = createJestConfig(customJestConfig);
