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
    'unicorn/no-nested-ternary': 'off',
    "unicorn/no-abusive-eslint-disable": "off",
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
  ignorePatterns: [
    "dist/",
    "**/dist/**",
    "node_modules/",
    "coverage/",
    "jest.config.ts",
    "ensureDb.js",
  ],
};
