// Relative paths that climb straight into a sibling app (../../api, ../api/dist/x).
// Anchored on leading ".." segments so apiv3's own src/modules/api stays legal.
const siblingApps = ["api", "jobs", "web"].flatMap((app) =>
  Array.from({ length: 8 }, (_, i) => {
    const up = "../".repeat(i + 1);
    return [`${up}${app}`, `${up}${app}/**`];
  }).flat(),
);

const restrictedImports = {
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
};

const restrictedSyntax = [
  {
    selector:
      "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
    message: "`as unknown as` is banned; narrow the type instead.",
  },
  {
    selector: "Decorator",
    message: "decorators are not used in apiv3",
  },
  {
    // \x2F is "/": esquery ends a regex at the first literal slash.
    selector:
      "ImportExpression[source.value=/^(\\.\\.\\x2F)+(api|jobs|web)(\\x2F|$)/]",
    message: "apiv3 never imports apps/api, apps/jobs or apps/web.",
  },
  {
    selector:
      "CatchClause > BlockStatement[body.length=1] > ExpressionStatement > CallExpression[callee.property.name=/^(warn|error|info|debug)$/]",
    message: "a catch must rethrow or return a typed result after logging",
  },
];

// Tests pin behaviour at real boundaries; these shapes only restate the code.
const testSyntax = [
  {
    selector:
      "CallExpression[callee.property.name=/^(toBeDefined|toBeTruthy|toBeFalsy)$/]",
    message: "assert the exact value, not that something exists",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(toHaveBeenCalled|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled|toBeCalledWith)$/]:not([callee.object.property.name='not'])",
    message:
      "assert the observable result (response, row, recorded request), not that a mock was called; .not.toHaveBeenCalled() and toHaveBeenCalledTimes() stay allowed",
  },
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.value=/^[.]/]",
    message: "mock only external packages; run apiv3's own modules for real",
  },
];

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
    "no-restricted-imports": ["error", restrictedImports],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
    ],
    "no-restricted-syntax": ["error", ...restrictedSyntax],
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-console": "error",
  },
  overrides: [
    {
      files: ["test/**/*.ts"],
      rules: {
        "no-restricted-syntax": ["error", ...restrictedSyntax, ...testSyntax],
      },
    },
    {
      // A module may not reach into another module's repo.
      files: ["src/modules/*/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            ...restrictedImports,
            patterns: [
              ...restrictedImports.patterns,
              "../*/repo",
              "../*/repo.js",
            ],
          },
        ],
      },
    },
  ],
};
