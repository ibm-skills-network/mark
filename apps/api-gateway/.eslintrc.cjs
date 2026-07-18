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
    "unicorn/prevent-abbreviations": [
      "error",
      {
        checkFilenames: false,
      },
    ],
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "unicorn"],
  root: true,
  ignorePatterns: ["dist/", "node_modules/", "coverage/", "jest.config.ts"],
  overrides: [
    {
      files: ["**/*.spec.ts", "**/*.test.ts"],
      rules: {
        "unicorn/no-abusive-eslint-disable": "off",
      },
    },
  ],
};
