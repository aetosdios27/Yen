# YEN-59 Public Fund Page at Scale: CDN Caching, ETags, Origin Protection

This note documents the public fund read delivery path: the CDN cache headers, the event hash validators, the per IP miss budget, and the single flight origin read, plus the boundaries of each. The implementation lives in `apps/api/src/public-cache.ts`, `apps/api/src/app.ts` (the `fundRead` and `conditionalPublicRead` helpers), and `apps/api/src/public-fund-store.ts` (`PostgresPublicFundHeadStore`).

## Header Semantics

Anonymous responses on the public fund pages (`/public/summary`, `/public/breakdown`, `/public/timeline`, public expense reads, audit bundle, record proofs) carry:

| Header | Value | Meaning |
| --- | --- | --- |
| `Cache-Control` | `public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` | Shared caches keep a copy for 60 seconds, may serve it stale for 300 more while revalidating in the background, and may serve it for a day when the origin is failing. |
| `ETag` | `W/"<fundId>-<latestEventHash>"` | Weak validator derived from the head of the fund's event log. Any appended event rotates it. |
| `Cache-Tag` | `fund-<fundId>, org-<orgId>` | Purge targets. Tags are emitted even when the validator falls back to a body hash in memory mode. |
| `Vary` | `authorization, cookie` | A signed in visitor gets the private view at the same URL, so shared caches must never mix them. |
| `Warning`, `X-Yen-Data-As-Of` | `110 - "Response is stale"`, ISO timestamp | Present only when the origin served the last good copy after a failure inside the stale window. |

Authenticated responses never carry public cache headers: they are stamped `private, no-store` and are never written to the public cache or tagged for CDN purge. Requests for a private fund from an anonymous visitor answer `404` with no cache headers at all.

## Validator Lifecycle

The public response validator is `W/"<fundId>-<latestEventHash>"`. The origin compares an incoming `If-None-Match` against the event log head using one indexed query (`publicFundHeadSql`) that also gates on `visibility_tier = 'public'` and returns the org id for purge tags. Consequences:

- A conditional request against a cold origin costs one head lookup and returns `304` without the page read.
- A conditional request against a warm origin cache costs zero queries.
- Any fund event (pledges, verifications, expenses, membership and policy changes) rotates the validator, so validators never mask content that the event log produced.
- Mutations that change public content without appending a fund event do not rotate the validator. Today that is anchor confirmation (timeline and summary `verified` fields flipping from `bank-matched` to `anchored`) and the officeholder display name flag. Deployments must purge `fund-<fundId>` through the CDN when those change, as described below, or accept staleness until the next fund event.
- When the head lookup is unavailable (memory mode, or a failed lookup), responses fall back to the SHA 256 body hash validator, which behaves like the pre YEN-59 scheme.

`Cache-Control: no-cache` from the client forces the full origin produce before answering; if the fresh body matches the client validator, the origin still answers `304` after doing the work.

## Purge Flow via Cache-Tag

CDNs that support tag based invalidation (for example Cloudflare `Cache-Tag` or Fastly surrogates) can drop every page of one fund without touching other funds:

1. Read `Cache-Tag` from any cached public response of the fund. It names both `fund-<fundId>` and `org-<orgId>`.
2. Issue the provider's purge call with that tag after a mutation that bypasses the fund's event log (anchor confirmation, officeholder display flag) or when an immediate flip is required instead of waiting out `s-maxage`.
3. Org level purges use `org-<orgId>` when a tenant wide change makes every fund page suspect at once.

The per fund cache in the API invalidates itself automatically after every successful `POST`/`PUT`/`PATCH` under `/v1/funds/<fundId>`, so within one origin instance only the non event mutations above need an explicit purge.

## Origin Protection Boundaries

**Per IP miss budget.** Origin page reads are rate limited per client IP (10 reads per second, token bucket) using the shared `RateLimitStore`, keyed as `["fund_cache_miss", ip]`. Cache hits, warm `304` answers, and head lookup driven `304` answers never consume budget; a single flight burst consumes one token because only the leader reaches the guarded produce. When the budget is exhausted the origin answers `429` with `Retry-After`; if a stale page exists inside the stale window, the origin serves that copy instead of shedding the request.

**Single flight request coalescing.** Concurrent misses for the same fund and page share one in flight origin read and one in flight head lookup (`PublicReadCache.load`). The head lookup result is cached for the same 60 second fresh window and dropped together with the pages by `fundCacheInvalidation`.

**Process boundary.** Both the cache and the coalescer are per process. With N API instances behind a load balancer, a cold spike costs up to N origin reads (one per instance) plus N head lookups; the CDN in front absorbs the rest. The `RateLimitStore` is shared (Postgres in production), so the per IP miss budget is global across instances. Writes invalidate only the writing instance's cache; other instances age out within the 60 second fresh window.

## Privacy Matrix

The privacy matrix is pinned by `apps/api/src/public-fund-cdn.test.ts`:

- Authenticated owner, donor, treasurer, approver and member views of a public fund page answer `private, no-store` with no `ETag`, no `Cache-Tag`, and no write to the public cache.
- The cached public body never contains owner only fields (verified by content assertions against the cached entry).
- Anonymous requests for a private or missing fund answer `404` with no cache headers and no cache writes.
- Authenticated non public routes never emit public cache headers.
- Public expense reads at the same URL as private views are separated by `Vary: authorization, cookie` and are stored under distinct cache kinds.

## Benchmark

`scripts/bench-fund-cache-spike.ts` drives 1,000 concurrent anonymous requests against the summary route in process with counted store level reads:

```sh
pnpm exec tsx scripts/bench-fund-cache-spike.ts
```

Measured on an Apple silicon laptop with Node 22 via tsx, one run:

- Cold conditional spike (CDN revalidation storm, empty origin cache): 1,000 requests, 1,000 x 304, 0 page reads + 1 head lookup = 1 db read.
- Cold miss spike (cache flush or new origin instance): 1,000 requests, 1,000 x 200, 1 page read + 0 head lookups = 1 db read.
- Warm hit spike: 1,000 requests, 1,000 x 200, 0 db reads.
- Authorization lookups (`fundStore.get`, primary key, never coalesced): 2,000 across the three spikes; `304` answers skip them entirely.

Each spike stays within the budget of at most 2 combined page reads plus head lookups.
