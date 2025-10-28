export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "scope-enum": [
      2,
      "always",
      [
        "api",
        "web",
        "docs",
        "deps",
        "tests",
        "ci",
        "build",
        "chore",
        "feat",
        "fix",
        "perf",
        "refactor",
        "revert",
        "style",
      ],
    ],
  },
};
