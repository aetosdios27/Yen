# Money path objectives and dashboards

Pilot targets below apply over a rolling 30 days. They are proposals, not claims
about production performance. Tune them against pilot traffic before adopting
commitments. `packages/shared/src/slo.ts` is the typed target registry.

| Objective id              | Target | Measurement                                                                  |
| ------------------------- | ------ | ---------------------------------------------------------------------------- |
| approval_api_availability | 99.5%  | Approval route responses below HTTP 500                                      |
| approve_p95_latency       | 95%    | Approval response below 500 and duration <= 1,000 ms                         |
| pay_p95_latency           | 95%    | Pay response below 500 and duration <= 1,500 ms                              |
| donation_recording        | 99.5%  | Donation pledge recording responses below 500                                |
| event_append              | 99.9%  | Database event append attempts complete without error                        |
| reconciliation_lag        | 99%    | Samples with no unverified pledge older than 15 minutes                      |
| anchor_lag                | 99%    | Samples with no event beyond the last confirmed anchor older than 60 minutes |
| public_page_availability  | 99.5%  | External page probe returns HTTP 2xx within 10 seconds                       |

All objectives emit `yen.slo.observations` with `yen.slo.id` and boolean
`yen.slo.good` labels. Availability treats validation and authorization failures
as successful service responses. Latency includes these responses. Event append
measures the append statement, not the eventual enclosing transaction commit.
Reconciliation and anchor objectives are time-based samples of **outstanding**
work, rather than completion latency: a failed consumer must not report healthy
lag just because it completes nothing. The queue runtime samples every 30 seconds;
an empty backlog is healthy. Run one designated collector runtime to avoid
weighting one interval multiple times. Reconciliation currently measures donation
pledges awaiting verification; bank-feed ingestion delay is outside this SLI.

Public-page availability uses `scripts/probe-public-page.ts`: schedule
`PUBLIC_PAGE_PROBE_URL=https://your-public-fund-page OTEL_EXPORTER_OTLP_ENDPOINT=https://collector pnpm exec tsx scripts/probe-public-page.ts`
once per minute from outside the service network. Network failures, timeouts and
non-2xx responses count as bad. It checks HTML delivery, not client rendering.
Configure a stable public fixture page. No URL is exported in telemetry.

## Dashboard definition (one dashboard per objective)

Provision these eight dashboards by substituting each objective id above. This
is a documented dashboard definition; no hosted monitoring stack exists yet.
Use the exported counter's backend-normalized name (for example
`yen_slo_observations_total` in Prometheus), with `yen_slo_id` and
`yen_slo_good` labels. Confirm normalization in the collector when provisioning.

Each dashboard contains:

1. Total and bad observations per minute, plus a no-data panel.
2. Thirty-day success fraction: `1 - bad_30d / total_30d`, and the target line.
3. Remaining event budget: `max(0, (1-target)*total_30d - bad_30d)` and remaining
   budget fraction `max(0, 1 - bad_30d / ((1-target)*total_30d))`.
4. Burn rate `bad_window / total_window / (1-target)` for 5m, 30m, 1h and 6h.
5. The saturation panels below and a link to traces for the matching operation.

For **every objective**, page when both the 1h and 5m burn rates are >= 14.4;
create a ticket when both the 6h and 30m burn rates are >= 6. Evaluate those
pairs separately; do not substitute a 1h rate into the 6h rule. Require positive
observation counts in both windows. Alert on missing collector samples for two
minutes separately; zero data is unknown, not 100% availability. Suppress ticket
notifications while the page condition is active. The existing
`calculateBurnRate` and `emitBurnRateAlert` helpers support evaluating one pair;
the monitoring backend owns window aggregation and alert delivery.

This follows the multiwindow approach in the
[Google SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/).
Repeated budget exhaustion should pause risky releases and prioritize reliability
work without weakening money controls.

## Saturation and tracing

Histograms `yen.pool.connections` (database-wide client connections),
`yen.queue.depth` (created/retry/active jobs), `yen.event_loop.lag` (maximum delay
in ms per 30s interval), and `yen.append_lock.wait` (ms per lock acquisition,
including failed attempts) provide saturation panels. Pool connections are
aggregated from `pg_stat_activity`, not the private internal state of one
Postgres.js pool; compare with the sum of configured pool caps. Queue and pool
samples come from the designated worker. Append wait is instrumented at the
actual event append lock. Event-loop delay is measured in API and worker
processes with export enabled. Plot p50/p95/max and queue/connection counts;
thresholds depend on deployment capacity.

Export is opt-in through `OTEL_EXPORTER_OTLP_ENDPOINT` for API/workers and
`NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT` for the browser. The browser collector
must permit the web origin via CORS. Browser API requests send `traceparent` and
a UUID `x-request-id`; the API exports the same request id as `yen.request.id`.
Transactional enqueues persist only a W3C traceparent under reserved
`__yenTelemetry`; workers restore the parent before executing the handler.
Inbound tracestate and baggage are dropped; only the traceparent is propagated.
No raw URL, payload, identity, amount, exception message or stack is
copied into spans. Logs use template routes and the existing structured schema.
YEN-20 / PR #135 owns additional free-text log redaction and error reporting.

The operator must deploy collectors, configure browser export/CORS, provision
these dashboards and alert routes, and schedule the supplied public page probe. Tests use
in-memory exporters and real Postgres; they do not prove hosted alert delivery.

## Approval trace acceptance boundary

The Postgres journey test exercises the browser fetch wrapper, real HTTP handler,
committed approval/event, transactional queue enqueue, and a running worker in
one trace. Its notification adapter enqueues a real pg-boss job. Production
bootstrap currently leaves PIN notifications on `MemoryPinNotificationService`;
a durable production notification adapter is still required before claiming
production approval-to-worker delivery. This work instruments the queue boundary
without inventing a new approval side effect. Also, the ledger reservation is
posted on submission; approval persists approval state and an event, not a second
money journal entry. The literal approval-to-new-journal acceptance criterion
needs clarification against that existing money model.
