/* eslint-env node */
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json"],
    warnOnUnsupportedTypeScriptVersion: false,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:unicorn/recommended",
    // Must come last so it disables every formatting rule (e.g.
    // unicorn/number-literal-case) that fights the pre-commit prettier pass.
    "prettier",
  ],
  rules: {
    "unicorn/prefer-top-level-await": "off",
    "unicorn/no-nested-ternary": "off",
    "unicorn/no-null": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/require-await": "off",
    "unicorn/no-abusive-eslint-disable": "off",
    "unicorn/prevent-abbreviations": [
      "error",
      {
        checkFilenames: false,
      },
    ],
  },
  plugins: ["@typescript-eslint", "unicorn"],
  root: true,
  ignorePatterns: [
    "dist/",
    "**/dist/**",
    "node_modules/",
    "coverage/",
    "jest.config.ts",
    "test/",
    "**/tests/**",
    "**/__tests__/**",
    "**/__mocks__/**",
    "**/*.spec.ts",
    "**/*.test.ts",
  ],
};
