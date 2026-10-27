# apiv3

The TypeScript rebuild of Mark's backend. It is served behind the API gateway
one route family at a time and keeps the same public paths as v2. It stays
inert until a family is listed in the deploy values.

## Layout

```text
src/
  http/      Fastify app and plugins; composed in http/app.ts
  worker/    claim loop and health server; composed in worker/main.ts
  modules/<m>/
             routes.ts, service.ts, repo.ts, schema.ts; tests under test/
  ops/       reserved for the operation store
  shared/    config, logger, prisma, errors, ids
```

## Rules

1. Modules import only `shared/` and `ops/`, never another module's repo, never `apps/api`, `apps/jobs`, `apps/web` (lint errors, static and dynamic imports).
2. No decorators (lint error), no DI container, no global interceptors: a route is a function with a schema, composed in `http/app.ts` and `worker/main.ts`.
3. Every route has a zod request schema and a zod response schema (`buildApp` refuses to register a route outside `/health/` without `schema.response`); the response serializer always enforces the schema (unknown keys stripped, type mismatch is a 500 `RESPONSE_SCHEMA_VIOLATION`) and `V3_VALIDATE_RESPONSES=true` adds a stricter re-parse for staging.
4. Every route and handler logs entry, outcome and each external call with `requestId` and the ids it knows, never headers, cookies, secrets or bodies.
5. A route's query count is asserted in its test with `expectQueries`.
6. No `any`, no `as unknown as`, no empty catch, no catch that only logs, no `console` (lint errors). A catch must rethrow or return a typed result after logging.
7. One file per external system under `shared/clients/`.

## Configuration

Booleans are true only for the literal `true`. Anything else is false.

| Variable                       | Default   | Notes                                                             |
| ------------------------------ | --------- | ----------------------------------------------------------------- |
| `SERVICE_NAME`                 | `mark-v3` | Name used in logs.                                                |
| `PORT`                         | `3000`    | HTTP port.                                                        |
| `LOG_LEVEL`                    | `info`    | `debug`, `info`, `warn` or `error`.                               |
| `DATABASE_URL`                 | required  | Must include `?pgbouncer=true` when connecting through pgbouncer. |
| `V3_VALIDATE_RESPONSES`        | `false`   | Stricter response re-parse. Meant for staging.                    |
| `V3_CONSUME_WORK`              | `false`   | The worker claims work only when `true`.                          |
| `V3_DISPATCH_EXTERNAL_EFFECTS` | `false`   | Allows the worker to call external systems.                       |
| `WORKER_HEALTH_PORT`           | `8081`    | Port of the worker health server.                                 |

## Running locally

apiv3 uses the same generated Prisma client as the API, built from
`apps/api/prisma/schema.prisma`. The root `resolutions` pin `@prisma/client`
and `prisma` to 5.3.1, so both apps get the same version. Generate the client
before linting, testing or building:

```sh
yarn workspace apiv3 prisma:generate
```

```sh
yarn workspace apiv3 dev          # HTTP server with reload
yarn workspace apiv3 build        # bundle to dist/
yarn workspace apiv3 start:http   # run the built HTTP server
yarn workspace apiv3 start:worker # run the built worker
```

Both processes answer `GET /health/liveness` and `GET /health/readiness`. The
HTTP server uses `PORT`, the worker uses `WORKER_HEALTH_PORT`. Every HTTP
response carries an `x-request-id` header. An incoming `akamai-grn` or
`x-request-id` header is reused, otherwise a UUID is generated.

## Tests

Most tests need no database. Tests under `test/db` need a scratch Postgres and
are skipped unless `DATABASE_URL_TEST` is set:

```sh
export DATABASE_URL_TEST='postgres://<user>:<password>@localhost:6001/<scratch_db>' # pragma: allowlist secret
yarn workspace apiv3 test
```

`DATABASE_URL_TEST` must point at the scratch database on port 6001, never the
dev `mark-pg` database or whatever `DATABASE_URL` points at.

`test/helpers/db.ts` provides `withTestDb(fn)` (client with query logging,
always disconnected) and `expectQueries(prisma, n, fn)`, which fails when `fn`
runs more than `n` queries. `expectQueries` shares one counter, so use it
sequentially, not from concurrent tests in the same file.

## Flipping a family and rolling back

The gateway reads `MARK_V3_API_ENDPOINT` and `MARK_V3_ROUTES`. The mark chart
sets both from its `v3Api` values: `enabled`, `name`, `port` and `routes`.

The route families are `session-meta`, `learner-reads`,
`learner-attempt-writes` and `learner-submit`.

The first enablement is two deploys. First set `enabled: true` with
`routes: []`, which deploys the wiring and routes nothing. Then add the family
to `routes`.

The `x-mark-backend` response header shows who answered, `v3` or `legacy`.

To roll back, remove the family from `routes` and deploy. Requests go back to
the legacy API. The worker claims work only when `V3_CONSUME_WORK=true`, so
leave it off until the worker is meant to take over.

## Bench

See `bench/README.md` for the latency bench and how to record results.

## Comparing backends

`scripts/compare-backends.mjs` sends the same synthetic `user-session` requests
to the legacy API and to v3 and compares status and raw body. It reads
`MARK_API_ENDPOINT` and `MARK_V3_API_ENDPOINT`, so run it inside the gateway pod:

```sh
kubectl --context <ctx> -n mark exec -i deploy/mark-api-gateway -c mark-api-gateway -- node - < apps/apiv3/scripts/compare-backends.mjs
```

It prints one `MATCH` or `DIFF` line per case, exits 0 when every case matches,
1 otherwise, and 2 if an endpoint variable is missing.
