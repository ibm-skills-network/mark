# Email bounce ingestion

Mark's jobs worker polls IBM Event Notifications every 15 minutes. Invalid
mailboxes (`error_message` exactly `UNKNOWN_USER`) become `HARD_BOUNCE`
suppressions. Other bounces, including policy/unknown failures, automatically
pause an address after two distinct events within seven days. Routine auditing
of the admin page is not required. Three distinct recipients at a domain within
seven days produce a diagnostic warning; a whole domain is never blocked.

## Automatic temporary recovery

1. Two recent bounces start a 24-hour hold.
2. Once it expires, one naturally triggered email is reserved atomically across
   all workers. No separate test email or replay of skipped messages is sent.
3. SMTP acceptance starts a 24-hour observation period, during which additional
   mail to that address is skipped. A complete subsequent bounce sweep must
   cover the period before normal sending resumes.
4. A bounced trial starts a three-day hold, then seven days on subsequent
   failures. Seven days is the maximum; automatic trials continue. Extra reports
   from mail already in flight before the trial do not increase the stage.
5. A recovered address retains its escalation history for 30 quiet days. A new
   failure during that time returns it to the next hold stage. After 30 days,
   two new failures are required and the pause starts at 24 hours again.

IBM's documented metrics are aggregate counts, not a verified per-message SMTP
receipt that this integration can correlate. Neither SMTP acceptance nor absence
of a bounce is called confirmed delivery. `recoveredAt` means normal sending
resumed after observation. A late trial bounce can still reapply a hold.

Trials require a successful poll in the last 45 minutes and no recorded poll
error. Partial/failed sweeps never reopen an address. A process crash or missing
SMTP result keeps the trial reserved for 24 hours; a complete sweep then permits
another natural trial. A known local SMTP failure waits another day without
increasing the recipient's failure stage. Trials older than IBM's 30-day replay
window require a fresh trial rather than assuming delivery. Hard-bounce,
complaint, and manual suppressions always take precedence. Admin overrides are
available for exceptional cases and retain the same late-report protection.

## Configuration and rollout

Apply migrations `20261028120000_email_bounce_ingestion` and
`20261028230000_email_delivery_recovery` before deploying the API and jobs worker;
regenerate Prisma clients during the normal build. Configure:

| Variable | Where | Value |
| --- | --- | --- |
| `EMAIL_BOUNCE_INSTANCE_ID` | API and jobs | IBM Event Notifications instance UUID |
| `EMAIL_BOUNCE_SMTP_CONFIG_ID` | API and jobs | Mark's SMTP configuration UUID, specific to this environment |
| `EMAIL_BOUNCE_API_URL` | Jobs only | Regional API base, e.g. `https://us-south.event-notifications.cloud.ibm.com/event-notifications` |
| `EMAIL_BOUNCE_API_KEY` | Jobs secret | IAM API key with access to read the instance's bounce metrics |
| `ENABLE_JOB_SCHEDULERS` | Jobs | Existing scheduler switch, `true` |
| `EMAIL_BOUNCE_POLL_ENABLED` | Jobs | Opt-in switch, `true`; disabled when absent |
| `EMAIL_DELIVERY_ALERT_WEBHOOK_URL` | Jobs secret | Optional HTTPS webhook accepting JSON `{ "text": "..." }`, e.g. an operations Slack incoming webhook |

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

On first enable, the job imports nearly 30 days, including suppressions for
historical invalid mailboxes. Check that this is the intended configuration
before switching polling on. Check the dashboard after the first interval.
Disabling the opt-in switch stops ingestion and recovery, preserving existing
permanent suppressions and temporary holds. Resume healthy polling or use an
admin override to release a hold; turning polling off is not a bypass.

## Exception alerts

Ten distinct recipients across at least three domains with non-mailbox bounces
within one hour trigger `email.bounce.sender_warning` at error level. Route this
event through the existing log alerting pipeline, or configure the webhook above
for proactive notification. The webhook sends counts, not recipient addresses.
Alerts are claimed atomically and limited to one per hour across replicas.
Failed webhook deliveries retry on the next poll without undoing a successful
bounce sweep. Alert failure logs contain neither webhook URLs nor credentials.
This is an infrastructure exception to investigate, not a routine bounce audit.
Thresholds are deliberately initial operational defaults, not a diagnosis of
sender reputation or proof that a receiving organisation blocked Mark.

## Reliability and limitations

- Each sweep uses a fixed 29-day, 23-hour window ending one minute behind the
  worker clock. The hour of headroom keeps the start inside IBM's rolling 30-day
  retention boundary during pagination. Recovery uses the same window so older
  probes require a fresh trial. Requests use explicit `limit=100` and offset
  pagination. Pages are paced one second
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
- Releasing a permanent suppression or temporary hold retains an admin/timestamp record. Replayed events and
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
- Already-submitted mail may bounce after suppression. The legacy permanent-list
  lookup retains its fail-open behavior, but when recovery is configured its
  transactional send gate fails closed on database errors to preserve the
  one-trial limit. This also applies to admin sign-in mail. Log events distinguish
  `email.skipped.suppressed`, `email.skipped.temporary_hold`, and
  `email.skipped.recovery_unavailable`. Zero further bounces cannot be promised.

Grade-sync email behavior is unchanged: the normal retry sequence sends one
initial-failure notice and one terminal-failure notice, not a notice per retry.

## Verification

API tests cover the IBM contract and existing send-time suppression. Jobs tests
cover pagination, lease contention/loss, partial failures, and rate-limit cooldown.
The admin panel test covers warning visibility and release requests.

The PostgreSQL integration suite creates an isolated schema, applies the three
email migrations, and drops the schema on completion. Point it only at a test
database using `EMAIL_BOUNCE_TEST_DATABASE_URL`, then run from `apps/api`:

```sh
yarn jest --runInBand --runTestsByPath src/auth/services/email-bounce.integration.spec.ts
```

It checks concurrent replay, transactional rollback, release versus late arrival,
release/ingestion races, preservation of complaint reasons, source isolation,
distinct-recipient domain warnings, concurrent trial reservation, escalating
holds, observation, abandoned trials, and quiet-period reset. During the seven days after deployment,
monitor last-success age, ingestion errors, and sends after suppression rather
than asserting that an address can never have two provider bounce records.
