# apiv3

Fastify backend for Mark (v3). Independent of `apps/api`, `apps/jobs` and `@nestjs/*`.

- `yarn dev` - run the HTTP server with reload
- `yarn test` - run vitest
- `yarn lint` - run eslint

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
