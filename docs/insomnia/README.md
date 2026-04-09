# Insomnia Collections

## Job Microservice

`job-microservice.insomnia.json` tests the Mark API internal callback used by
`apps/jobs`.

Run locally:

```sh
yarn test:insomnia:jobs
```

The local test script starts Redis/Postgres through `yarn db`, starts the jobs
worker, starts Mark API, waits for API readiness and the jobs-worker heartbeat,
then runs the Insomnia suite. It stops the API and jobs processes it started
when the test finishes.

On macOS, install the CLI with:

```sh
brew install --cask inso
```

The automated suite only covers safe contract behavior:

- API readiness preflight
- missing or invalid `x-job-queue-secret`
- malformed job request bodies
- unsupported queue names
- unsupported job names for every queue consumed by `apps/jobs`
- dry-run translation fix job enqueueing
- dry-run translation sweep enqueueing

The positive-path coverage uses dry-run admin translation jobs so it exercises
successful job creation without mutating staging or production assignment data.

For CI, set `INSOMNIA_MARK_API_BASE_URL` and `INSOMNIA_JOB_QUEUE_SECRET` secrets.
The workflow injects those values into the selected Insomnia environment at run
time instead of committing environment secrets to the collection.
