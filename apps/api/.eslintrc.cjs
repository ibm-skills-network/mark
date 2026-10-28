/* eslint-env node */
const V3_SHARED_ALLOWLIST = [
  "database/prisma.service",
  "database/database.module",
  "common/v3-scope",
  // Security checks with one implementation: SSRF-safe fetching, learner URL
  // rules, GitHub content fetching and admin session verification.
  "api/attempt/common/utils/ssrf-safe-http",
  "api/attempt/common/utils/learner-url.util",
  "api/attempt/common/utils/github-content-fetch.util",
  "auth/admin-auth.module",
  "auth/services/admin-verification.service",
];

const V3_BANNED_PACKAGES = [
  "express",
  "@nestjs/platform-express",
  "class-validator",
  "class-transformer",
];

const BANNED_LEGACY_MESSAGE =
  "v3 code must not import legacy modules; only the shared infrastructure allowlist is permitted.";

// gitignore-style group: ban everything under `prefix`, then re-include v3
// itself and the allowlist. A file can only be re-included when every parent
// directory is re-included too, so each ancestor of an allowlist entry is
// re-included (shallowest first) with its own contents banned again.
function bannedLegacyGroup(prefix) {
  const ancestors = [
    ...new Set(
      V3_SHARED_ALLOWLIST.flatMap((path) => {
        const parts = path.split("/").slice(0, -1);
        return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
      }),
    ),
  ].sort((a, b) => a.split("/").length - b.split("/").length);
  return [
    `${prefix}**`,
    `!${prefix}v3`,
    `!${prefix}v3/**`,
    ...ancestors.flatMap((dir) => [`!${prefix}${dir}`, `${prefix}${dir}/**`]),
    ...V3_SHARED_ALLOWLIST.map((path) => `!${prefix}${path}`),
  ];
}

// Relative imports are judged by how far the importing file sits below
// src/v3: climbing further than that leaves v3 and is only allowed for the
// shared allowlist.
function v3ImportRules(depth) {
  return {
    paths: V3_BANNED_PACKAGES.map((name) => ({
      name,
      message: "Not allowed in v3 code.",
    })),
    patterns: [
      {
        group: [...V3_BANNED_PACKAGES.map((name) => `${name}/**`)],
        message: "Not allowed in v3 code.",
      },
      {
        group: bannedLegacyGroup("src/"),
        message: BANNED_LEGACY_MESSAGE,
      },
      {
        group: bannedLegacyGroup("../".repeat(depth + 1)),
        message: BANNED_LEGACY_MESSAGE,
      },
    ],
  };
}

const V3_DEPTH_OVERRIDES = [
  ["src/v3/*.ts", 0],
  ["src/v3/*/*.ts", 1],
  ["src/v3/*/*/*.ts", 2],
  ["src/v3/*/*/*/*.ts", 3],
  ["src/v3/*/*/*/*/*.ts", 4],
].map(([glob, depth]) => ({
  files: [glob],
  rules: { "no-restricted-imports": ["error", v3ImportRules(depth)] },
}));

const loggerCall = [
  "[callee.object.name=/^(logger|log)$/]",
  "[callee.object.property.name=/^(logger|log)$/]",
]
  .map(
    (callee) =>
      `CatchClause[body.body.length=1] > BlockStatement > ExpressionStatement > CallExpression${callee}`,
  )
  .join(", ");

const jestMatcher = (names) =>
  `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${names.join("|")})$/]`;

module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    tsconfigRootDir: __dirname,
    project: [
      "./tsconfig.json",
      "./tsconfig.rich-text-migration.json",
      "./tsconfig.v3-test.json",
    ],
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
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "unicorn"],
  root: true,
  overrides: [
    ...V3_DEPTH_OVERRIDES,
    {
      files: ["src/v3/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "no-console": "error",
        "no-empty": ["error", { allowEmptyCatch: false }],
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "Decorator > CallExpression[callee.name=/^(Req|Res|Next|Request|Response)$/]",
            message:
              "Express request/response objects are not allowed in v3; use the v3 request context.",
          },
          {
            selector:
              "TSAsExpression > TSAsExpression > TSUnknownKeyword.typeAnnotation",
            message: "Do not chain `as unknown as`; fix the type.",
          },
          {
            selector: "CatchClause[body.body.length=0]",
            message: "Do not swallow errors in an empty catch block.",
          },
          {
            selector: loggerCall,
            message:
              "A catch block must handle the error, not only log it; rethrow or translate it.",
          },
        ],
      },
    },
    {
      files: ["src/**/*.ts"],
      excludedFiles: [
        "src/v3/**",
        "src/grading-bridge/**",
        "src/app.module.ts",
        "src/main.ts",
        "src/bootstrap/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["src/v3", "src/v3/**", "**/v3", "**/v3/**"],
                message: "Legacy code must not import v3 modules.",
              },
            ],
          },
        ],
      },
    },
    {
      // The one seam between legacy grading and v3: it may use v3 grading,
      // and nothing else in v3.
      files: ["src/grading-bridge/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "src/v3/**",
                  "!src/v3/grading",
                  "!src/v3/grading/**",
                  "../v3/**",
                  "!../v3/grading",
                  "!../v3/grading/**",
                  "../../v3/**",
                  "!../../v3/grading",
                  "!../../v3/grading/**",
                ],
                message:
                  "The grading bridge may import v3 grading only, not the rest of v3.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["test/v3/**/*.ts"],
      parserOptions: { project: ["./tsconfig.v3-test.json"] },
      rules: {
        // Test code reads supertest bodies (any) and uses short local names.
        "unicorn/prevent-abbreviations": "off",
        "unicorn/prefer-module": "off",
        "unicorn/better-regex": "off",
        "unicorn/no-await-expression-member": "off",
        "unicorn/consistent-function-scoping": "off",
        // supertest builders are thenables that are configured, then awaited.
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "no-restricted-syntax": [
          "error",
          {
            selector: jestMatcher(["toBeDefined", "toBeTruthy", "toBeFalsy"]),
            message: "Assert the exact value instead of existence/truthiness.",
          },
          {
            selector: `${jestMatcher([
              "toHaveBeenCalled",
              "toHaveBeenCalledWith",
              "toHaveBeenLastCalledWith",
              "toHaveBeenNthCalledWith",
              "toBeCalled",
              "toBeCalledWith",
            ])}:not([callee.object.property.name='not'])`,
            message:
              "Assert observable results; use toHaveBeenCalledTimes or .not.toHaveBeenCalled.",
          },
          {
            selector:
              "CallExpression[callee.object.name='jest'][callee.property.name=/^(mock|doMock)$/][arguments.0.value=/^\\./]",
            message:
              "Do not mock project modules; mock external packages only.",
          },
        ],
      },
    },
    {
      files: ["maintenance/rich-text-normalization/*.ts"],
      rules: { "unicorn/prefer-module": "off" },
    },
  ],
  ignorePatterns: [
    "dist/",
    "**/dist/**",
    "node_modules/",
    "coverage/",
    "jest.config.ts",
    "ensureDb.js",
    "check-question.ts",
    "prisma/seed.ts",
    "test/*",
    "**/tests/**",
    "**/__tests__/**",
    "**/*.spec.ts",
    "**/*.test.ts",
    // Re-include v3 tests (last match wins).
    "!test/v3/",
    "!test/v3/**/*.ts",
  ],
};
