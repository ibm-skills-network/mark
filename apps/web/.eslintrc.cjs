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
  plugins: ["@typescript-eslint", "simple-import-sort", "unused-imports"], //, "jsx-a11y"
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
    "no-console": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "react/no-unescaped-entities": "off",

    "react/display-name": "off",
    "react/jsx-curly-brace-presence": [
      "warn",
      { props: "never", children: "never" },
    ],

    //#region  //*=========== Unused Import ===========
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "warn",
    "unused-imports/no-unused-vars": [
      "warn",
      {
        vars: "all",
        varsIgnorePattern: "^_",
        args: "after-used",
        argsIgnorePattern: "^_",
      },
    ],
    //#endregion  //*======== Unused Import ===========

    //#region  //*=========== Import Sort ===========
    "simple-import-sort/exports": "warn",
    "simple-import-sort/imports": [
      "warn",
      {
        groups: [
          // ext library & side effect imports
          ["^@?\\w", "^\\u0000"],
          // {s}css files
          ["^.+\\.s?css$"],
          // Lib and hooks
          ["^@/lib", "^@/hooks"],
          // static data
          ["^@/data"],
          // components
          ["^@/components", "^@/container"],
          // zustand store
          ["^@/store"],
          // Other imports
          ["^@/"],
          // relative paths up until 3 level
          [
            "^\\./?$",
            "^\\.(?!/?$)",
            "^\\.\\./?$",
            "^\\.\\.(?!/?$)",
            "^\\.\\./\\.\\./?$",
            "^\\.\\./\\.\\.(?!/?$)",
            "^\\.\\./\\.\\./\\.\\./?$",
            "^\\.\\./\\.\\./\\.\\.(?!/?$)",
          ],
          ["^@/types"],
          // other that didnt fit in
          ["^"],
        ],
      },
    ],
    //#endregion  //*======== Import Sort ===========
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
  globals: {
    JSX: true,
    React: true,
  },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    ".turbo",
    "tailwind.config.js",
    "postcss.config.js",
    ".eslintrc.cjs",
  ],
};
