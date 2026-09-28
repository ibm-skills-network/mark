# rich-text

Conversion rules that turn the previous editor's HTML into the shapes the
current editor's schema reads, plus the shared "is this value empty?" check.

Used by `apps/web` (rendering and editing stored content), `apps/api` and
`apps/jobs` (the empty check, on submission paths), and by
`scripts/validate-rows.js`, which runs the rules against real stored rows.

## Why `main` points at `dist/`, and why that costs something

`package.json` has `"main": "./dist/index.js"`, so **consumers need this package
built before it resolves.** That is deliberate, and it is the reason for three
workarounds elsewhere. Please read this before "simplifying" any of them.

The obvious simplification is to point `main` at `src/index.ts` — it is a
private workspace package, `apps/web` already lists it in `transpilePackages`,
and that would delete every workaround below in one go.

**It would also break the api build.** `apps/api` is a Nest app compiled by
`tsc`. Importing TypeScript source from another workspace package puts files
outside the app's `rootDir` into its program, and the emitted `dist` layout
changes shape. `apps/jobs` compiles api source, so it breaks the same way. Only
`apps/web` can consume the source directly, and it is not the only consumer.

So the build stays, and these exist because of it:

| Where                                                                            | What                                                    | Why                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/jest.config.js`, `apps/api/jest.config.ts`, `apps/jobs/jest.config.ts` | `moduleNameMapper` maps `^rich-text$` to `src/index.ts` | So `yarn test` never depends on a build having happened first. `jobs` needs its own copy because it compiles api source.                                                                                                                       |
| `turbo.json`                                                                     | `lint` has `dependsOn: ["rich-text#build"]`             | ESLint resolves the package through `main`. Unbuilt, `import/no-unresolved` fires in web and the type-aware rules see `any` and fail in api. Named explicitly rather than `^build` — that would compile all of `apps/api` just to lint `jobs`. |
| `.github/workflows/build-images.yml`                                             | the lint step does **not** pass `--only`                | `--only` runs a task without its dependencies, which skips the build above. The test step keeps `--only`, because the jest mappers make tests build-free.                                                                                      |

If you do change `main`, expect to touch all four.

## The injected parser

`normalizeQuillHtml(html, { parse })` takes its HTML parser from the caller and
depends on none itself. The browser falls back to `DOMParser`; Node callers pass
their own (`normalize/test-parser.ts` for the suite, a local one in
`scripts/validate-rows.js`). This is what keeps a single implementation of the
rules while making it impossible for a Node DOM to be pulled into the web
bundle. Do not "simplify" it by adding a parser dependency — that is the trade
it exists to avoid.

## Changing a rule

Rules are keyed off markers the previous editor produced and no-op when the
marker is absent, so running them on already-converted content is a no-op and
running them twice gives the same answer as running them once. `normalizeQuillHtml`
returns its input **byte-identical** when nothing fires, which is what makes it
safe on a read path — a caller can compare and see no change.

Fixtures prove a rule does what its author intended. They do not prove it
against content nobody designed, which is a different question and the one that
has actually caught bugs:

```
yarn --cwd packages/rich-text build      # the script reads dist/
node packages/rich-text/scripts/validate-rows.js rows.json
```

See that script's header for how to dump `rows.json` read-only. Run it after any
rule change.
