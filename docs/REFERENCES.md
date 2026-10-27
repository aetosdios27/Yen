# References

## How to cite

ADRs and design-heavy pull requests must cite relevant entries here, explain what they take from each source and where the design differs, or explicitly say “no prior art found” when true. Before adding an entry, open and read the primary source, check its metadata, URL and the specific claim, and record any limits or differences. Entries for planned work are guidance, not evidence that it has shipped.

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

## Blockchain anchoring

<a id="opentimestamps"></a>
### A timestamping proof standard

- **Source:** OpenTimestamps; project documentation, undated (accessed 2026).
- **URL:** https://opentimestamps.org/
- **What we use it for:** A timestamp proof demonstrates data existed before a point in time. Yen publishes roots through an authorized Polygon contract rather than implementing the OpenTimestamps format or Bitcoin calendars.
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
