# mark-chat-ops

The contract between the Mark chat API and the author's browser: which
operations the model can ask the browser to run, what each one is called, and
the shape of its parameters.

- `apps/api` builds the author tools from `AUTHOR_OPERATIONS` (description and
  zod input schema) in `mark-chat.service.ts`.
- `apps/web` types its dispatcher (`runAuthorOperation` in
  `app/chatbot/store/authorStoreUtil.ts`) from the same entries, so a renamed
  or missing operation or parameter fails to compile.

## Compiled, not consumed as source

Unlike `rich-text`, the API imports this package at runtime, so it has a real
build. The `exports` entry points TypeScript at `src/` and runtime at `dist/`.

- `turbo build` builds it before its dependents (`^build`). `yarn dev` runs
  turbo with `--parallel`, which ignores task dependencies, so the API's `dev`
  script builds it first and this package's `dev` rebuilds it on change.
- Jest in `apps/api` maps the package to `src/`, so tests need no build.
- The API production image copies `packages/mark-chat-ops`, because the image
  keeps only `node_modules`, where the workspace symlink points here.
- `apps/web` imports types only, which keeps the zod schemas out of the
  browser bundle.

`apps/jobs` compiles API source but never reaches `mark-chat.service.ts`. If
that changes, its Dockerfile needs the same copy.
