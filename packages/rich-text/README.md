# rich-text

Conversion rules that turn the previous editor's HTML into the shapes the
current editor's schema reads, plus the shared "is this value empty?" check.

Used by `apps/web` (rendering and editing stored content) and by
`scripts/validate-rows.js`, which runs the rules against real stored rows.

## Consumed as source

`main` and `types` point at `src/index.ts`, and there is no `build` task. The
only runtime consumer is `apps/web`, which compiles the package itself through
`transpilePackages` in `next.config.js`. That's why lint, test and the Docker
build need no build step first.

Don't add a dependency from `apps/api` (or anything that compiles api source,
like `apps/jobs`) without first adding a real build. `nest build` can't
compile TypeScript from outside its `rootDir`, and the api production image
copies only `node_modules` and its own `dist`, so the workspace symlink would
point at nothing at runtime.

The `compile` script emits `dist/` for `scripts/validate-rows.js` alone.

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
yarn --cwd packages/rich-text compile    # the script reads dist/
node packages/rich-text/scripts/validate-rows.js rows.json
```

See that script's header for how to dump `rows.json` read-only. Run it after any
rule change.
