# References

## How to cite

ADRs and design-heavy pull requests must cite relevant entries here, explain what they take from each source and where the design differs, or explicitly say “no prior art found” when true. Before adding an entry, open and read the primary source, check its metadata, URL and the specific claim, and record any limits or differences. Entries for planned work are guidance, not evidence that it has shipped.

## Coverage

| Area                                 | Entries |
| ------------------------------------ | ------: |
| Tamper-evident logs and transparency |       8 |
| Canonical serialization              |       1 |
| Money and ledgers                    |       5 |
| Idempotency and retries              |       8 |
| Rate limiting and load shedding      |       7 |
| Testing and failure handling         |       4 |
| Benchmarking and latency             |       1 |
| SRE and observability                |       5 |
| PostgreSQL                           |      15 |
| Authentication and approvals         |       9 |
| Blockchain anchoring                 |       2 |
| Privacy and law                      |       4 |
| Supply chain and CI                  |       2 |
| Security and threat modeling         |       2 |
| **Total**                            |  **73** |

## Tamper-evident logs and transparency

<a id="crosby-wallach"></a>
### Efficient Data Structures for Tamper-Evident Logging

- **Source:** Scott A. Crosby and Dan S. Wallach; USENIX Security, 2009.
- **URL:** https://static.usenix.org/events/sec09/tech/full_papers/crosby.pdf
- **What we use it for:** Tree proofs support efficient inclusion and consistency auditing of an untrusted log. Yen verifies inclusion but does not yet offer consistency proofs.
- **Where in this repo:** packages/shared/src/merkle/README.md; packages/eventlog/README.md

<a id="rfc-6962"></a>
### Certificate Transparency

- **Source:** Ben Laurie, Adam Langley and Emilia Kasper; RFC 6962, 2013.
- **URL:** https://www.rfc-editor.org/rfc/rfc6962.html
- **What we use it for:** The Merkle split and leaf/node domains inform inclusion proofs. RFC signed tree heads authenticate size separately; Yen adds salted event leaves and commits counts in its nested root because a plain inclusion path alone can be ambiguous.
- **Where in this repo:** packages/shared/src/merkle/README.md

<a id="rfc-9162"></a>
### Certificate Transparency Version 2.0

- **Source:** Ben Laurie, Eran Messeri and Rob Stradling; RFC 9162, 2021.
- **URL:** https://www.rfc-editor.org/rfc/rfc9162.html
- **What we use it for:** Independent monitoring, consistency proofs and comparison of tree heads address misbehaving logs. Yen does not implement CT or gossip; a root alone cannot establish completeness or prevent split views.
- **Where in this repo:** packages/shared/src/merkle/README.md; contracts/README.md

<a id="coniks"></a>
### CONIKS: Bringing Key Transparency to End Users

- **Source:** Marcela S. Melara, Aaron Blankstein, Joseph Bonneau, Edward W. Felten and Michael J. Freedman; USENIX Security, 2015.
- **URL:** https://www.usenix.org/conference/usenixsecurity15/technical-sessions/presentation/melara
- **What we use it for:** Clients and providers can collectively audit key-directory equivocation while protecting user privacy. Yen is not a key directory and does not implement CONIKS monitoring.
- **Where in this repo:** packages/shared/src/merkle/README.md

<a id="cox-tlog"></a>
### Transparent Logs for Skeptical Clients

- **Source:** Russ Cox; research!rsc, 2019.
- **URL:** https://research.swtch.com/tlog
- **What we use it for:** Merkle trees allow skeptical clients to check inclusion and append-only growth. Yen currently provides inclusion proofs, not append-only consistency proofs.
- **Where in this repo:** packages/shared/src/merkle/README.md

<a id="schneier-kelsey"></a>
### Cryptographic Support for Secure Logs on Untrusted Machines

- **Source:** Bruce Schneier and John Kelsey; 7th USENIX Security Symposium, 1998.
- **URL:** https://www.usenix.org/conference/7th-usenix-security-symposium/cryptographic-support-secure-logs-untrusted-machines
- **What we use it for:** The paper protects earlier entries against undetected modification following compromise. Yen uses hash chains and externally authenticated heads, not the paper’s key-evolving encryption scheme or its confidentiality guarantee.
- **Where in this repo:** packages/eventlog/README.md

<a id="trillian-structures"></a>
### Verifiable data structures

- **Source:** Transparency.dev; Trillian documentation, undated (accessed 2026).
- **URL:** https://transparency.dev/verifiable-data-structures/
- **What we use it for:** Consistency proofs establish that a later log retains earlier entries in order. Yen provides inclusion proofs but not consistency proofs.
- **Where in this repo:** packages/shared/src/merkle/README.md

<a id="rfc-6234"></a>
### US Secure Hash Algorithms (SHA and SHA-based HMAC and HKDF)

- **Source:** Donald Eastlake 3rd and Tony Hansen; RFC 6234, 2011.
- **URL:** https://www.rfc-editor.org/rfc/rfc6234.html
- **What we use it for:** The RFC describes SHA-256 and provides sample implementations. Yen uses SHA-256 with its own domain-separated formats, not this RFC’s sample code.
- **Where in this repo:** packages/eventlog/README.md; packages/shared/src/merkle/README.md

## Canonical serialization

<a id="rfc-8785"></a>
### JSON Canonicalization Scheme (JCS)

- **Source:** Anders Rundgren, Brian Jordan and S. Erdtman; RFC 8785, 2020.
- **URL:** https://www.rfc-editor.org/rfc/rfc8785.html
- **What we use it for:** Canonical JSON gives repeatable bytes for cryptographic hashing. Yen additionally restricts event payloads and uses a versioned domain prefix.
- **Where in this repo:** packages/eventlog/README.md; packages/eventlog/src/canonical.ts

## Money and ledgers

<a id="stripe-ledger"></a>
### Ledger: Stripe’s system for tracking and validating money movement

- **Source:** Ilya Ganelin; Stripe, 2024.
- **URL:** https://stripe.dev/blog/ledger-stripe-system-for-tracking-and-validating-money-movement
- **What we use it for:** Immutable events and reconciliation metrics make movement auditable. Yen’s event format exists, but the ledger and reconciliation pipelines described in the product plan are not implemented by this article.
- **Where in this repo:** packages/eventlog/README.md; YEN-18

<a id="square-money"></a>
### Money

- **Source:** Square; Square API Reference, 2026 (API version 2026-09-16).
- **URL:** https://developer.squareup.com/reference/square/objects/Money
- **What we use it for:** Square represents amounts as integer smallest currency units. Yen uses paise and uses decimal strings on the API wire to preserve large integers.
- **Where in this repo:** apps/api/README.md; packages/db/README.md

<a id="fowler-money"></a>
### Money

- **Source:** Martin Fowler; Patterns of Enterprise Application Architecture catalog, 2003.
- **URL:** https://www.martinfowler.com/eaaCatalog/money.html
- **What we use it for:** A money type can prevent currency and rounding mistakes. Yen currently models paise for a single currency rather than carrying currency in each amount.
- **Where in this repo:** packages/shared/src; apps/api/README.md

<a id="tigerbeetle-account"></a>
### Account

- **Source:** TigerBeetle; TigerBeetle documentation, undated (accessed 2026).
- **URL:** https://docs.tigerbeetle.com/reference/account/
- **What we use it for:** TigerBeetle guarantees equal sums of posted debits and credits. Yen plans a Konto ledger; this is a reference for its invariants, not evidence those guarantees have shipped.
- **Where in this repo:** YEN-18

<a id="kleppmann-accounting"></a>
### Accounting for Computer Scientists

- **Source:** Martin Kleppmann; author’s blog, 2011.
- **URL:** https://martin.kleppmann.com/2011/03/07/accounting-for-computer-scientists.html
- **What we use it for:** Modeling accounts as nodes and transfers as edges illustrates balanced accounting. Yen’s ledger is planned; this explanation is not evidence that it has shipped.
- **Where in this repo:** YEN-18; packages/db/README.md

## Idempotency and retries

<a id="stripe-idempotency"></a>
### Designing robust and predictable APIs with idempotency

- **Source:** Brandur Leach; Stripe, 2017.
- **URL:** https://stripe.com/blog/idempotency
- **What we use it for:** Keys allow a client to retry an ambiguous operation and retrieve a cached result. Yen uses principal-scoped keys, exact request bytes and leases; its current in-memory store does not guarantee durable side-effect coordination.
- **Where in this repo:** apps/api/README.md

<a id="aws-retries"></a>
### Timeouts, retries, and backoff with jitter

- **Source:** Amazon Web Services; AWS Builders’ Library, undated (accessed 2026).
- **URL:** https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- **What we use it for:** Timeouts, bounded retries and jitter limit retry amplification and synchronized bursts. This is guidance for clients and future integrations, not a claim that the API implements retry logic.
- **Where in this repo:** apps/api/README.md

<a id="ietf-idempotency"></a>
### The Idempotency-Key HTTP Header Field

- **Source:** Jayadeba Jena, Sanjay Dalal and Dmitrii Tishkin; IETF Internet-Draft 08, 2026 (work in progress).
- **URL:** https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08
- **What we use it for:** The draft describes fingerprints, retries and conflicts for concurrent requests. Its structured-header string syntax differs from Yen’s current unquoted restricted header values; Yen does not claim conformance.
- **Where in this repo:** apps/api/README.md

<a id="aws-idempotency"></a>
### Making retries safe with idempotent APIs

- **Source:** Malcolm Featonby; AWS Builders’ Library, undated (accessed 2026).
- **URL:** https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- **What we use it for:** A client request identifier expresses retry intent, and recording it with mutations requires an atomic operation. Yen’s in-memory idempotency store does not yet provide durable coordination.
- **Where in this repo:** apps/api/README.md

<a id="aws-fallback"></a>
### Avoiding fallback in distributed systems

- **Source:** Jacob Gabrielson; AWS Builders’ Library, 2019.
- **URL:** https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/
- **What we use it for:** Rare fallback paths can add reliability risk; evaluate and test failure paths. This is guidance for future integration design, not a description of a Yen fallback implementation.
- **Where in this repo:** apps/api/README.md

<a id="pg-boss"></a>
### pg-boss: Background Jobs in PostgreSQL

- **Source:** Tim Jones and contributors; pg-boss v12 documentation, 2026.
- **URL:** https://pgboss.io
- **What we use it for:** Transactional background job queue in PostgreSQL using SKIP LOCKED, supporting outbox enqueue via caller-provided database transactions, configurable retries with backoff, and dead-letter queues.
- **Where in this repo:** packages/queue/README.md

<a id="bullmq"></a>
### BullMQ: Redis-based Distributed Message Queue

- **Source:** Taskforce.sh Inc.; BullMQ documentation, 2026.
- **URL:** https://docs.bullmq.io
- **What we use it for:** Evaluated alternative queue engine for high-throughput short idempotent jobs. Rejected for initial runtime due to separate Redis/Valkey operational requirement and lack of atomic transactions with PostgreSQL domain writes.
- **Where in this repo:** packages/queue/README.md

<a id="temporal"></a>
### Temporal Platform Documentation

- **Source:** Temporal Technologies Inc.; Temporal Platform Documentation, 2026.
- **URL:** https://docs.temporal.io
- **What we use it for:** Evaluated escape hatch for complex, long-running, multi-step workflows such as blockchain anchoring. Deferred until workflow duration or saga orchestration complexity exceeds defined exit thresholds.
- **Where in this repo:** packages/queue/README.md

## Rate limiting and load shedding

<a id="stripe-rate-limiters"></a>
### Scaling your API with rate limiters

- **Source:** Paul Tarjan; Stripe, 2017.
- **URL:** https://stripe.com/blog/rate-limiters
- **What we use it for:** Token buckets can limit API traffic to protect availability. Yen uses per-IP and per-principal in-memory buckets; multi-process limits require a shared store.
- **Where in this repo:** apps/api/README.md

<a id="sre-overload"></a>
### Handling Overload

- **Source:** Alejandro Forero Cuervo; Google, Site Reliability Engineering, 2016.
- **URL:** https://sre.google/sre-book/handling-overload/
- **What we use it for:** Graceful overload handling protects a serving system when capacity is exhausted. Use this when designing future load shedding.
- **Where in this repo:** apps/api/README.md

<a id="sre-cascading"></a>
### Addressing Cascading Failures

- **Source:** Mike Ulrich; Google, Site Reliability Engineering, 2016.
- **URL:** https://sre.google/sre-book/addressing-cascading-failures/
- **What we use it for:** Overload and retries can propagate failures across services. Use this to reason about recovery and capacity.
- **Where in this repo:** apps/api/README.md

<a id="aws-load-shedding"></a>
### Using load shedding to avoid overload

- **Source:** David Yanacek; AWS Builders’ Library, 2019.
- **URL:** https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/
- **What we use it for:** Rejecting excess work helps maintain service under overload. Yen’s per-process rate limits are not a full load-shedding system.
- **Where in this repo:** apps/api/README.md

<a id="rfc-6585"></a>
### Additional HTTP Status Codes

- **Source:** Mark Nottingham and Roy Fielding; RFC 6585, 2012.
- **URL:** https://www.rfc-editor.org/rfc/rfc6585.html
- **What we use it for:** HTTP 429 signals excessive requests and can include Retry-After. Yen returns 429 with a retry delay for rate limiting.
- **Where in this repo:** apps/api/README.md

<a id="rfc-9110"></a>
### HTTP Semantics

- **Source:** Roy T. Fielding, Mark Nottingham and Julian Reschke; RFC 9110, 2022.
- **URL:** https://www.rfc-editor.org/rfc/rfc9110.html
- **What we use it for:** Retry-After may be an HTTP date or a delay in seconds. Yen sends a delay in seconds.
- **Where in this repo:** apps/api/README.md

<a id="cloudflare-rate-headers"></a>
### Introducing new headers for rate limiting on Cloudflare’s API

- **Source:** Cloudflare; Cloudflare changelog, 2025.
- **URL:** https://developers.cloudflare.com/changelog/post/2025-09-03-rate-limiting-improvement/
- **What we use it for:** Cloudflare exposes quota and reset information and a Retry-After delay. Yen sends Retry-After but does not implement those Cloudflare quota headers.
- **Where in this repo:** apps/api/README.md

## Testing and failure handling

<a id="yuan-failures"></a>
### Simple Testing Can Prevent Most Critical Failures: An Analysis of Production Failures in Distributed Data-Intensive Systems

- **Source:** Ding Yuan, Yu Luo, Xin Zhuang, Guilherme Renna Rodrigues, Xu Zhao, Yongle Zhang, Pranay U. Jain and Michael Stumm; USENIX OSDI, 2014.
- **URL:** https://www.usenix.org/conference/osdi14/technical-sessions/presentation/yuan
- **What we use it for:** The studied failures show that testing error-handling paths can prevent catastrophic failures. This motivates tests of failed persistence and retry paths.
- **Where in this repo:** apps/api/src/app.test.ts

<a id="foundationdb"></a>
### FoundationDB: A Distributed Unbundled Transactional Key Value Store

- **Source:** Jingyu Zhou and coauthors; ACM SIGMOD, 2021.
- **URL:** https://www.foundationdb.org/files/fdb-paper.pdf
- **What we use it for:** FoundationDB uses deterministic simulation to exercise distributed failures. Yen’s local tests are not FoundationDB-style distributed simulation.
- **Where in this repo:** packages/db/src/test/database.test.ts

<a id="jepsen-models"></a>
### Consistency Models

- **Source:** Jepsen; consistency reference, undated (accessed 2026).
- **URL:** https://jepsen.io/consistency/models
- **What we use it for:** The model hierarchy distinguishes serializability, linearizability and strict serializability when reasoning about concurrent histories. It does not establish a consistency guarantee for Yen.
- **Where in this repo:** packages/db/README.md

<a id="brandur-queues"></a>
### Postgres Job Queues & Failure By MVCC

- **Source:** Brandur Leach; author’s blog, 2015.
- **URL:** https://brandur.org/postgres-queues
- **What we use it for:** Long-running transactions can prevent cleanup of dead tuples and degrade a Postgres queue. Yen has no such job queue here; use this when evaluating a future queue.
- **Where in this repo:** packages/db/README.md

## Benchmarking and latency

<a id="gregg-use"></a>
### The USE Method

- **Source:** Brendan Gregg; FISL13 presentation, 2012.
- **URL:** https://www.brendangregg.com/Slides/FISL13_USE_Method/
- **What we use it for:** Inspect utilization, saturation and errors for each resource when investigating performance. This is a diagnostic method, not evidence of a Yen benchmark.
- **Where in this repo:** apps/api/README.md

## SRE and observability

<a id="sre-slo"></a>
### Service Level Objectives

- **Source:** Chris Jones, John Wilkes, Niall Murphy and Cody Smith; Google, Site Reliability Engineering, 2016.
- **URL:** https://sre.google/sre-book/service-level-objectives/
- **What we use it for:** Define user-relevant indicators and objectives before managing reliability. Yen has readiness and request logs but no SLO defined here.
- **Where in this repo:** apps/api/README.md

<a id="sre-burn"></a>
### Alerting on SLOs

- **Source:** Google; Site Reliability Workbook, 2018.
- **URL:** https://sre.google/workbook/alerting-on-slos/
- **What we use it for:** Burn-rate alerts connect error-budget consumption to actionable alerting. This is guidance, not an implemented alert.
- **Where in this repo:** apps/api/README.md

<a id="otel-overview"></a>
### Overview

- **Source:** OpenTelemetry; OpenTelemetry Specification, undated (accessed 2026).
- **URL:** https://opentelemetry.io/docs/specs/otel/overview/
- **What we use it for:** The specification describes telemetry APIs, SDKs and collectors. Yen’s structured request logs are not an OpenTelemetry implementation.
- **Where in this repo:** apps/api/src/logging.ts

<a id="sre-monitoring"></a>
### Monitoring Distributed Systems

- **Source:** Rob Ewaschuk; Google, Site Reliability Engineering, 2016.
- **URL:** https://sre.google/sre-book/monitoring-distributed-systems/
- **What we use it for:** Monitoring should support actionable alerts and visibility into system behavior. Yen’s current request logs are a foundation, not a complete monitoring system.
- **Where in this repo:** apps/api/README.md

<a id="sre-implementing-slos"></a>
### Implementing SLOs

- **Source:** Steven Thurgood and David Ferguson, with Alex Hidalgo and Betsy Beyer; Google, Site Reliability Workbook, 2018.
- **URL:** https://sre.google/workbook/implementing-slos/
- **What we use it for:** Different request classes can need different latency and availability targets. Yen has not defined those SLOs here.
- **Where in this repo:** apps/api/README.md

## PostgreSQL

<a id="pg-isolation"></a>
### Transaction Isolation

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/transaction-iso.html
- **What we use it for:** Isolation levels determine what concurrent transactions can observe. Use this when designing database-backed idempotency and append transactions.
- **Where in this repo:** packages/db/README.md; apps/api/README.md

<a id="pg-locking"></a>
### Explicit Locking

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/explicit-locking.html
- **What we use it for:** Transaction-level advisory locks release at transaction end and are application-defined. The event append lock is a planned follow-up, not implemented in the current event-log package.
- **Where in this repo:** packages/eventlog/README.md; YEN-18

<a id="pg-select"></a>
### SELECT

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-select.html
- **What we use it for:** SKIP LOCKED can help queue consumers but produces an inconsistent view. It is a future queue design reference, not a claim that Yen uses it.
- **Where in this repo:** packages/db/README.md

<a id="pg-partition"></a>
### Table Partitioning

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/ddl-partitioning.html
- **What we use it for:** Declarative partitioning divides a logical table into partitions. Consider its constraints before partitioning future event tables; the current migration does not do so.
- **Where in this repo:** packages/db/migrations/0001_app_tables.sql

<a id="pg-lexical"></a>
### Lexical Structure

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-syntax-lexical.html
- **What we use it for:** SQL comments, quoting and dollar-quoted strings affect statement boundaries. Yen’s migration preflight is a conservative scanner, not a complete PostgreSQL parser.
- **Where in this repo:** packages/db/src/sql-statements.ts

<a id="pg-strings"></a>
### Version and Platform Compatibility

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/runtime-config-compatible.html
- **What we use it for:** The standard_conforming_strings setting changes interpretation of backslashes in ordinary strings. Migration preflight must account for this distinction.
- **Where in this repo:** packages/db/src/sql-statements.ts

<a id="brandur-job-drain"></a>
### Transactionally Staged Job Drains in Postgres

- **Source:** Brandur Leach; author’s blog, 2017.
- **URL:** https://brandur.org/job-drain
- **What we use it for:** Staging jobs in the transaction makes them invisible to a worker until commit. Yen proposes an outbox alongside event append but has not implemented this job-drain design.
- **Where in this repo:** packages/eventlog/README.md

<a id="pg-explain"></a>
### EXPLAIN

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-explain.html
- **What we use it for:** EXPLAIN displays a query plan; ANALYZE executes the statement and can have side effects. This is diagnostic guidance, not a Yen benchmark.
- **Where in this repo:** packages/db/README.md

<a id="pg-timeouts"></a>
### Client Connection Defaults

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/runtime-config-client.html
- **What we use it for:** statement_timeout bounds statement execution, while lock_timeout applies to individual lock waits. These settings are references for future operational configuration, not asserted Yen defaults.
- **Where in this repo:** packages/db/README.md

<a id="pg-constraints"></a>
### Constraints

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/ddl-constraints.html
- **What we use it for:** Database constraints reject invalid values and can enforce uniqueness. Yen’s migrations use constraints; the proposed event append invariants require additional enforcement.
- **Where in this repo:** packages/db/migrations/0001_app_tables.sql; packages/eventlog/README.md

<a id="pg-row-security"></a>
### Row Security Policies

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- **What we use it for:** Enabled row security defaults to deny when no policy exists, but table owners typically bypass it. Yen’s API policy hooks are not PostgreSQL row security.
- **Where in this repo:** apps/api/README.md; packages/db/README.md

<a id="pg-insert"></a>
### INSERT

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-insert.html
- **What we use it for:** ON CONFLICT DO UPDATE provides an atomic insert-or-update outcome. That primitive alone does not coordinate Yen’s idempotency record with external side effects.
- **Where in this repo:** apps/api/README.md; packages/db/README.md

<a id="pg-trigger"></a>
### CREATE TRIGGER

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-createtrigger.html
- **What we use it for:** TRUNCATE triggers are statement-level, unlike row-level insert, update and delete triggers. Yen’s event-log README proposes triggers; they are not implemented in the current event-log package.
- **Where in this repo:** packages/eventlog/README.md

<a id="pg-privileges"></a>
### Privileges

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/ddl-priv.html
- **What we use it for:** UPDATE, DELETE and TRUNCATE are separate privileges, while ownership carries powers that cannot simply be revoked. Yen’s proposed append-only enforcement must account for privileged roles.
- **Where in this repo:** packages/eventlog/README.md

<a id="pg-index"></a>
### CREATE INDEX

- **Source:** PostgreSQL Global Development Group; PostgreSQL 16 documentation, 2023.
- **URL:** https://www.postgresql.org/docs/16/sql-createindex.html
- **What we use it for:** A unique partial index can enforce uniqueness for a subset of rows. This is a schema-design reference, not a claim that such an index implements Yen’s future ledger invariants.
- **Where in this repo:** packages/db/README.md

## Authentication and approvals

<a id="webauthn-2"></a>
### Web Authentication: An API for accessing Public Key Credentials Level 2

- **Source:** W3C; W3C Recommendation, 2021.
- **URL:** https://www.w3.org/TR/webauthn-2/
- **What we use it for:** Relying parties generate random challenges and verify returned assertions. The current API reserves an authentication contract; passkey verification and transaction approval are future work.
- **Where in this repo:** apps/api/README.md; YEN-22

<a id="webauthn-3"></a>
### Web Authentication: An API for accessing Public Key Credentials Level 3

- **Source:** W3C; W3C Recommendation, 2026.
- **URL:** https://www.w3.org/TR/webauthn-3/
- **What we use it for:** Relying parties use random challenges and verify returned values to resist replay. Yen does not yet implement passkeys or transaction approvals.
- **Where in this repo:** apps/api/README.md; YEN-22

<a id="owasp-api"></a>
### OWASP Top 10 API Security Risks – 2023

- **Source:** OWASP API Security Project; OWASP, 2023.
- **URL:** https://api-security.owasp.org/editions/2023/en/0x11-t10/
- **What we use it for:** Object-level and property-level authorization failures are API risks. Yen’s stub fund routes use policy and redaction hooks; production policy remains future work.
- **Where in this repo:** apps/api/README.md

<a id="owasp-transaction"></a>
### Transaction Authorization

- **Source:** OWASP; OWASP Cheat Sheet Series, undated (accessed 2026).
- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
- **What we use it for:** Users should identify significant transaction data such as amount and target before authorizing. Yen’s approval flow is not implemented yet.
- **Where in this repo:** YEN-26

<a id="rfc-9457"></a>
### Problem Details for HTTP APIs

- **Source:** Mark Nottingham, Erik Wilde and Sanjay Dalal; RFC 9457, 2023.
- **URL:** https://www.rfc-editor.org/rfc/rfc9457.html
- **What we use it for:** Machine-readable error details help clients interpret HTTP failures. Yen uses its own nested error envelope and does not claim RFC 9457 conformance.
- **Where in this repo:** apps/api/README.md

<a id="nist-800-63b"></a>
### Digital Identity Guidelines: Authentication and Lifecycle Management

- **Source:** Paul A. Grassi, James L. Fenton, Elaine M. Newton, Ray A. Perlner, Andrew R. Regenscheid, William E. Burr, Justin P. Richer, Naomi B. Lefkovitz, J.M. Danker, Yee-Yin Choong, Kristen K. Greene and Mary F. Theofanos; NIST Special Publication 800-63B, 2017 (updated 2020).
- **URL:** https://pages.nist.gov/800-63-3/sp800-63b.html
- **What we use it for:** Memorized secret verifiers require rate limiting and lockout controls to mitigate online guessing (Sections 5.1.1.2 and 5.2.2). Out-of-band authenticators (SMS/PSTN) carry risks of SIM swap and phone number recycling.
- **Where in this repo:** docs/THREAT-MODEL.md

<a id="owasp-auth"></a>
### Authentication Cheat Sheet

- **Source:** OWASP; OWASP Cheat Sheet Series, undated (accessed 2026).
- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- **What we use it for:** Multi-factor authentication, account recovery, rate limiting, and cooling-off periods. Yen requires phone-proving OTP for new devices and PIN resets, while a PIN alone never authorizes a new device.
- **Where in this repo:** docs/THREAT-MODEL.md

<a id="owasp-password-storage"></a>
### Password Storage Cheat Sheet

- **Source:** OWASP; OWASP Cheat Sheet Series, undated (accessed 2026).
- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **What we use it for:** Low-entropy secrets such as 6-digit PINs require keyed hashing (peppering) with a secret held outside the database to prevent offline cracking if database contents leak.
- **Where in this repo:** docs/THREAT-MODEL.md

<a id="rfc-2104"></a>
### HMAC: Keyed-Hashing for Message Authentication

- **Source:** H. Krawczyk, M. Bellare and R. Canetti; RFC 2104, 1997.
- **URL:** https://www.rfc-editor.org/rfc/rfc2104.html
- **What we use it for:** Keyed-hashing binds an external secret to a message or secret value, preventing offline brute-force attacks against low-entropy inputs when the key is withheld.
- **Where in this repo:** docs/THREAT-MODEL.md

## Blockchain anchoring

<a id="opentimestamps"></a>
### A timestamping proof standard

- **Source:** OpenTimestamps; project documentation, undated (accessed 2026).
- **URL:** https://opentimestamps.org/
- **What we use it for:** A timestamp proof demonstrates data existed before a point in time. Yen publishes roots through an authorized Polygon contract rather than implementing the OpenTimestamps format or Bitcoin calendars.
- **Where in this repo:** contracts/README.md

<a id="ethereum-reorg"></a>
### Ethereum proof-of-stake attack and defense

- **Source:** Ethereum.org; Ethereum documentation, undated (accessed 2026).
- **URL:** https://ethereum.org/developers/docs/consensus-mechanisms/pos/attack-and-defense/
- **What we use it for:** Chain reorganizations and finality delays are distinct risks when assessing publication. Yen targets Polygon PoS, whose consensus and finality must be assessed separately; testnets may reset.
- **Where in this repo:** contracts/README.md

## Privacy and law

<a id="dpdp-act"></a>
### The Digital Personal Data Protection Act, 2023

- **Source:** Government of India, Ministry of Law and Justice; Gazette of India, 2023.
- **URL:** https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf
- **What we use it for:** Section 6 limits consent to personal data necessary for the specified purpose. Pseudonymization and minimizing event payloads do not alone establish compliance.
- **Where in this repo:** packages/eventlog/README.md; packages/db/README.md

<a id="dpdp-commencement"></a>
### Digital Personal Data Protection Act commencement notification

- **Source:** Ministry of Electronics and Information Technology; Gazette of India, 2025.
- **URL:** https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
- **What we use it for:** Different provisions commence on different dates; assess the current commencement and rules when making compliance decisions.
- **Where in this repo:** packages/db/README.md

<a id="ico-pseudonymisation"></a>
### Pseudonymisation

- **Source:** Information Commissioner’s Office; UK GDPR guidance, undated (accessed 2026).
- **URL:** https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/
- **What we use it for:** Pseudonymisation reduces identification risk but does not automatically make data anonymous. This UK guidance is a design reference, not a determination of Indian legal compliance.
- **Where in this repo:** packages/eventlog/README.md; packages/db/README.md

<a id="dpdpa-transcription"></a>
### Digital Personal Data Protection Act, 2023 Transcription (Sections 8 and 12)

- **Source:** Prashant Mali; dpdpa.com transcription and legal interpretation, 2023.
- **URL:** https://dpdpa.com/dpdpa2023/chapter-2/section8.html
- **What we use it for:** Section 8(7) mandates erasure when the purpose is served unless retention is required by another law; Section 12(3) establishes the right to erasure subject to statutory retention obligations.
- **Where in this repo:** docs/THREAT-MODEL.md

## Supply chain and CI

<a id="slsa"></a>
### SLSA specification

- **Source:** SLSA; Linux Foundation, version 1.2, undated (accessed 2026).
- **URL:** https://slsa.dev/spec/v1.2/
- **What we use it for:** SLSA defines security levels and provenance for supply chains. Yen’s pinned actions do not by themselves establish a SLSA level.
- **Where in this repo:** .github/workflows/ci.yml

<a id="github-actions"></a>
### Secure use reference

- **Source:** GitHub; GitHub Docs, undated (accessed 2026).
- **URL:** https://docs.github.com/en/actions/reference/security/secure-use
- **What we use it for:** GitHub recommends pinning third-party actions to full commit SHAs. Yen pins its workflow actions; pinning alone does not establish their safety.
- **Where in this repo:** .github/workflows/ci.yml

## Security and threat modeling

<a id="stride-approach"></a>
### Uncover Security Design Flaws Using The STRIDE Approach

- **Source:** Shawn Hernan, Scott Lambert, Tomasz Ostwald and Adam Shostack; Microsoft Corporation, MSDN Magazine, 2006.
- **URL:** https://learn.microsoft.com/en-us/archive/msdn-magazine/2006/november/uncover-security-design-flaws-using-the-stride-approach
- **What we use it for:** STRIDE maps six threat categories to security properties and to data-flow diagram elements. Yen applies STRIDE to its money paths and trust boundaries; the article says threat modeling cannot prove a design secure, so the threat model records residual risk rather than claiming absence of threats.
- **Where in this repo:** docs/THREAT-MODEL.md

<a id="owasp-threat-modeling"></a>
### Threat Modeling Cheat Sheet

- **Source:** OWASP; OWASP Cheat Sheet Series, undated (accessed 2026).
- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- **What we use it for:** Uses STRIDE categories as prompts against a system model and lists four responses to a threat (mitigate, eliminate, transfer, accept). It asks teams to document remaining risk and who owns it, but gives no method for measuring residual risk. Yen records residual risk and out-of-scope conditions per threat.
- **Where in this repo:** docs/THREAT-MODEL.md
