module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.test.json"],
    tsconfigRootDir: __dirname,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  ignorePatterns: ["dist", "node_modules"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          "**/apps/api/**",
          "**/apps/jobs/**",
          "**/apps/web/**",
          "**/api/src/**",
          "**/jobs/src/**",
          "**/web/src/**",
          "@nestjs/*",
          "reflect-metadata",
        ],
      },
    ],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
        message: "`as unknown as` is banned; narrow the type instead.",
      },
    ],
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-console": "error",
  },
};
