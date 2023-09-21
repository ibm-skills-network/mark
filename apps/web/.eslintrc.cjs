/* eslint-env node */

module.exports = {
  // root: true,
  // env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/recommended",
    // "plugin:react/recommended",
    // "plugin:jsx-a11y/recommended",
    "eslint-config-prettier",
    "eslint-config-next",
    "prettier",
    "next/core-web-vitals",
  ],
  parserOptions: {
    project: "./tsconfig.json",

    babelOptions: {
      presets: [require.resolve("next/babel")],
    },
  },
  settings: {
    next: {
      rootDir: __dirname,
    },
    // react: {
    //   version: "detect",
    // },
    // "import/parsers": {
    //   "@typescript-eslint/parser": [".ts", ".tsx"],
    // },
    // "import/resolver": {
    //   typescript: {
    //     alwaysTryTypes: true
    //   },
    //   node: {
    //     extensions: [".js", ".jsx", ".ts", ".tsx"]
    //   }
    // },
  },
  plugins: ["@typescript-eslint"], // "react", "jsx-a11y"
  rules: {
    "@typescript-eslint/no-non-null-assertion": "off",
    // "react/react-in-jsx-scope": "off",
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksVoidReturn: false,
      },
    ],
    "@typescript-eslint/no-empty-interface": ["warn"],
    "no-empty-pattern": ["warn"],

    // "unicorn/prevent-abbreviations": [
    //   "error",
    //   {
    //     checkFilenames: false,
    //     allowList: {
    //       props: true,
    //       ref: true,
    //       refs: true,
    //       req: true,
    //       res: true,
    //       args: true,
    //       ctx: true,
    //       env: true,
    //       err: true,
    //       e: true,
    //       dev: true,
    //       prod: true
    //     },
    //   },
    // ],
    // "react/prop-types": "off"
  },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    ".turbo",
    "tailwind.config.js",
    "postcss.config.js",
    ".eslintrc.cjs",
    "**/depreciated/*",
  ],
};
