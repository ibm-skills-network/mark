// Relative paths that climb straight into a sibling app (../../api, ../api/dist/x).
// Anchored on leading ".." segments so apiv3's own src/modules/api stays legal.
const siblingApps = ["api", "jobs", "web"].flatMap((app) =>
  Array.from({ length: 8 }, (_, i) => {
    const up = "../".repeat(i + 1);
    return [`${up}${app}`, `${up}${app}/**`];
  }).flat(),
);

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
        paths: ["api", "jobs", "web", "reflect-metadata"],
        patterns: [
          "**/apps/api/**",
          "**/apps/jobs/**",
          "**/apps/web/**",
          ...siblingApps,
          "api/*",
          "jobs/*",
          "web/*",
          "@nestjs/*",
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
        selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
        message: "`as unknown as` is banned; narrow the type instead.",
      },
    ],
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-console": "error",
  },
};
