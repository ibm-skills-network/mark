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
    "prettier",
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:unicorn/recommended",
  ],
  rules: {
    "unicorn/prefer-top-level-await": "off",
    "unicorn/prevent-abbreviations": [
      "error",
      {
        checkFilenames: false,
      },
    ],
    // --- temporary overrides ---
    "@typescript-eslint/no-unsafe-call": [
      "warn",
    ],
    "@typescript-eslint/no-unsafe-member-access": [
      "warn",
    ],
    "@typescript-eslint/no-unsafe-assignment": [
      "warn",
    ],
    "@typescript-eslint/no-unsafe-return": [
      "warn",
    ],
    // ---------------------------

  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "unicorn"],
  root: true,
  ignorePatterns: ["dist/", "node_modules/", "coverage/", "jest.config.ts"],
};
