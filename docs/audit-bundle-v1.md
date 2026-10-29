# Audit bundle v1

The standalone verifier's wire format and limitations are documented in [`packages/verifier/README.md`](../packages/verifier/README.md). Bundle events preserve the immutable `@yen/eventlog` envelope; proofs preserve `@yen/shared`'s two-level salted event inclusion format. This does not imply Yen has deployed a publication pipeline: the Amoy manifest remains a template.
