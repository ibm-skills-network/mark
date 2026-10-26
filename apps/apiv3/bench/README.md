# apiv3 latency bench

Dependency-free Node (>= 24) script that compares route latency across backends.

```
node bench.mjs --backend mark-api,mark-v3-api --routes routes.learner.json \
  --session session.json --assignment 123 --attempt 456 [--conc 1,5] [--n 60,150] [--warmup 3] [--json out.json]
```

- `--backend`: comma-separated hosts; bare `host:port` becomes `http://host:port`.
- `--routes`: JSON map of `name` to path; `{assignmentId}` / `{attemptId}` are filled from `--assignment` / `--attempt`.
- `--session`: optional JSON object sent as the `user-session` header. Omit for no header.
- `--conc` / `--n`: concurrency levels and one request count per level.
- Output is a markdown table (`route | conc | backend | p50 | p95 | p99 | rps | errors | bytes`), latencies in ms. Any non-200 or thrown fetch is an error. `--json` also writes the raw rows.

Route sets: `routes.health.json` (liveness, readiness) and `routes.learner.json` (the four learner reads).

## Running on staging

Run from inside the gateway pod so the numbers exclude client network latency:

```
kubectl --context <ctx> -n <ns> cp apps/apiv3/bench <gateway-pod>:/tmp/bench
kubectl --context <ctx> -n <ns> exec -it <gateway-pod> -- sh -c \
  'cd /tmp/bench && node bench.mjs --backend mark-api,mark-v3-api --routes routes.learner.json --session session.json --assignment <id> --attempt <id>'
```

The session file must be a synthetic learner with a real `groupId` and `assignmentId` on staging, for example
`{"userId":"bench@example.com","role":"learner","groupId":"<group>","assignmentId":<id>,"gradingCallbackRequired":false}`.
Do not use a real learner's identity.

## Pod memory

```
kubectl exec <api-pod> -- cat /sys/fs/cgroup/memory.current
kubectl exec <api-pod> -- cat /sys/fs/cgroup/memory.peak
```

Read both before and after a run; values are bytes.

## Recording results

Append each run's table (with date, image tags, and memory readings) to the local `RESULTS.md`. That file is not in the repo.
