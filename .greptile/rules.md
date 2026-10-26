# Review priorities for Yen

1. Can this change lose, create, or misattribute money? Check paise handling, rounding, and double-posting.
2. Can this change let someone see or do something they should not? Trace the path through `can()` and `redact()`.
3. Can this change make the event log or Merkle proofs unverifiable? Hashing inputs, canonicalization, ordering and domain separation must stay stable; golden-file tests pin them.
4. What happens on retry, crash, or replay halfway through?
5. Is the failure visible? Silent catch blocks and swallowed errors are bugs here.

Do not comment on formatting; Biome enforces it.
