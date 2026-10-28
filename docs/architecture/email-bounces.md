# Email bounce ingestion

Mark's jobs worker polls IBM Event Notifications every 15 minutes. Invalid
mailboxes (`error_message` exactly `UNKNOWN_USER`) become `HARD_BOUNCE`
suppressions. `MESSAGE_REFUSED`, `UNKNOWN_ERROR`, and unrecognized diagnostics
are recorded without automatic suppression. Three distinct recipients with
`MESSAGE_REFUSED` or `UNKNOWN_ERROR` at a domain within seven days produce an
admin dashboard warning. Domain warnings never block a whole domain.

## Configuration and rollout

Apply migration `20261028120000_email_bounce_ingestion` before deploying the API
and jobs worker; regenerate Prisma clients during the normal build. Configure:

| Variable | Where | Value |
| --- | --- | --- |
| `EMAIL_BOUNCE_INSTANCE_ID` | API and jobs | IBM Event Notifications instance UUID |
| `EMAIL_BOUNCE_SMTP_CONFIG_ID` | API and jobs | Mark's SMTP configuration UUID, specific to this environment |
| `EMAIL_BOUNCE_API_URL` | Jobs only | Regional API base, e.g. `https://us-south.event-notifications.cloud.ibm.com/event-notifications` |
| `EMAIL_BOUNCE_API_KEY` | Jobs secret | IAM API key with access to read the instance's bounce metrics |
| `ENABLE_JOB_SCHEDULERS` | Jobs | Existing scheduler switch, `true` |
| `EMAIL_BOUNCE_POLL_ENABLED` | Jobs | Opt-in switch, `true`; disabled when absent |

The API and jobs must use the same instance/configuration pair. Never point
staging at production's SMTP configuration. SMTP credentials are not implicitly
reused for API access. No new runtime dependencies are required.

Before enabling, fetch a read-only sample for the intended configuration and
verify the payload against `IbmBounceClient`. The adapter follows the published
[IBM Node SDK](https://github.com/IBM/event-notifications-node-admin-sdk/blob/main/event-notifications/v1.ts)
`BounceMetrics` shape: `metrics`, `total_count`, and rows with `email_address`,
`subject`, `error_message`, `timestamp`, optional `ip_address`/`subscription_id`.
Tests use synthetic fixtures; a production response and IAM permissions still
need verification. If IBM returns diagnostic text rather than exact reason
codes, it is retained but not interpreted as proof of an invalid mailbox.

On first enable, the job imports the last 30 days, including suppressions for
historical invalid mailboxes. Check that this is the intended configuration
before switching polling on. Check the dashboard after the first interval.
Disabling the opt-in switch stops ingestion but preserves existing suppressions.

## Reliability and limitations

- Each sweep uses a fixed 30-day window ending one minute behind the worker
  clock, explicit `limit=100`, and offset pagination. Pages are paced one second
  apart. Full overlapping sweeps recover late reports and partial failures.
- A database lease prevents worker replicas from issuing simultaneous sweeps.
  It expires after five minutes and renews before each page. HTTP requests time
  out after 20 seconds. Failed polls wait at least 15 minutes; a longer IBM
  `Retry-After` is honored. Successful sweeps clear error state.
- A failed or malformed page does not advance the last-success timestamp.
  The UI marks monitoring stale after 45 minutes without a successful sweep.
  Logs include `email.bounce.poll_failed`, `email.bounce.poll_completed`, and
  `email.bounce.domain_warning` when a domain's warning count changes.
- IBM does not expose a unique bounce ID in this payload. A SHA-256 fingerprint
  of the source and stable row fields deduplicates replay. Indistinguishable
  rows count once; this is sufficient for mailbox suppression and distinct
  recipient warnings, but is not an exact delivery-attempt accounting system.
- Inserting the event and applying suppression share one transaction. A failed
  suppression rolls back the event so a subsequent sweep retries it. Existing
  complaint/manual reasons are preserved.
- Releasing an address retains an admin/timestamp record. Replayed events and
  late reports at or before release cannot resuppress it. A newer invalid-mailbox
  report can. Ingestion and release share a transaction-level advisory lock.
- Event history is retained; subjects and relay IPs are hashed, not stored.
  Do not prune event fingerprints inside the 30-day replay window or release
  records independently of the ingestion policy.
- At current volume, rescanning 30 days is intentionally simple. Revisit the
  polling frequency/window if API usage grows. Outages longer than IBM's
  reporting window require manual investigation; this cannot recover expired
  provider history. Offset pagination cannot provide a provider snapshot, so
  subsequent overlapping sweeps also reconcile rows arriving during pagination.
- Already-submitted mail may bounce after suppression. The existing send-time
  lookup also intentionally fails open on database failure, including for admin
  sign-in emails. This change does not promise zero further bounces.

Grade-sync email behavior is unchanged: the normal retry sequence sends one
initial-failure notice and one terminal-failure notice, not a notice per retry.

## Verification

API tests cover the IBM contract and existing send-time suppression. Jobs tests
cover pagination, lease contention/loss, partial failures, and rate-limit cooldown.
The admin panel test covers warning visibility and release requests.

The PostgreSQL integration suite creates an isolated schema, applies the two
email migrations, and drops the schema on completion. Point it only at a test
database using `EMAIL_BOUNCE_TEST_DATABASE_URL`, then run from `apps/api`:

```sh
yarn jest --runInBand --runTestsByPath src/auth/services/email-bounce.integration.spec.ts
```

It checks concurrent replay, transactional rollback, release versus late arrival,
release/ingestion races, preservation of complaint reasons, source isolation,
and distinct-recipient domain warnings. During the seven days after deployment,
monitor last-success age, ingestion errors, and sends after suppression rather
than asserting that an address can never have two provider bounce records.
