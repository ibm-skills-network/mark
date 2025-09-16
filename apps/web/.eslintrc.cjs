module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/recommended",
    "prettier",
    "plugin:import/warnings",
    "plugin:import/typescript",
  ],
  parserOptions: {
    project: "./tsconfig.json",
    babelOptions: {
      presets: [require.resolve("next/babel")],
    },
  },
  settings: {
    "import/resolver": {
      typescript: {
        project: "./tsconfig.json",
      },
    },
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/restrict-plus-operands": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksVoidReturn: false,
      },
    ],
    "@typescript-eslint/no-empty-interface": ["warn"],
    "no-empty-pattern": ["warn"],
  },
  ignorePatterns: [
    "app/learner/\\(components\\)/**/*.js",
    "dist/",
    "node_modules/",
    ".turbo",
    "tailwind.config.ts",
    "postcss.config.js",
    ".eslintrc.cjs",
    "**/depreciated/*",
  ],
};
