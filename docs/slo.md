# Money path SLO proposal

These targets are proposals for a pilot, not measured service performance. The repository has no production traffic history yet. Tune the latency thresholds and lag objectives with pilot data before treating them as commitments.

The typed source of truth is [`packages/shared/src/slo.ts`](../packages/shared/src/slo.ts); consumers can import `SLOS` and `BURN_ALERT_THRESHOLDS`. Availability counts successful API responses (HTTP below 500) for the approval route group. Latency SLIs use the fraction of requests below the configured threshold. Reconciliation and anchoring lag use the fraction of completed work items within the configured maximum lag. Do not count client validation/authentication failures as service errors. Route labels must remain templates; never attach user identifiers, phone numbers, names, UPI identifiers, or personal amounts to telemetry.

| SLI                       |                   Pilot objective | Measurement                                                            |
| ------------------------- | --------------------------------: | ---------------------------------------------------------------------- |
| Approval API availability |                99.5% over 30 days | `/v1/funds/{fundId}/expenses/{expenseId}/approve`, responses below 500 |
| Approve latency           |   95% under 1,000 ms over 30 days | API request duration histogram                                         |
| Pay latency               |   95% under 1,500 ms over 30 days | API request duration histogram                                         |
| Reconciliation lag        | 99% under 15 minutes over 30 days | event time to successful reconciliation                                |
| Anchor lag                | 99% under 60 minutes over 30 days | eligible event time to confirmed anchor                                |

## Error budget policy

For each 30-day objective, the error budget is `1 - objective`. A burn rate is the observed bad-event ratio divided by that allowed ratio. Use paired windows to avoid paging on brief noise: page when burn is at least 14.4x over 60 minutes and 5 minutes; create a ticket at 6x over 6 hours and 30 minutes. These thresholds follow the multiwindow approach in the [Google SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/). Repeated budget exhaustion should pause risky releases and prioritize reliability work; it is not a reason to weaken money-path authorization or reconciliation controls.

`calculateBurnRate` is pure and does not send alerts. An alerting consumer can pass a narrow adapter implementing the existing queue `AnchorAlertSink` shape; Yen does not implement paging or an external alert integration here. The exporter uses the vendor-neutral OpenTelemetry API and SDK model described in the [OpenTelemetry overview](https://opentelemetry.io/docs/specs/otel/overview/). Metrics are exported through OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured. Export is disabled when it is absent. There is no public `/metrics` route.

## Current measurement

The objectives above are **not measured**. Request RED metrics currently cover API requests by route template (count, status, and duration); business-operation and lag metrics require durable workers and event timestamps to be instrumented before they can be reported reliably. Treat the targets as a starting proposal only.
