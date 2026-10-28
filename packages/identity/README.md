# @yen/identity

The Yen ID identity system provides human-readable, spoken-friendly identifiers for user accounts within Yen, an Indian community transparency platform.

---

## 1. Yen ID Format & Design Rationale

A Yen ID is a **9-digit decimal number**, formatted in groups of three separated by spaces:

$$\text{Example: } \mathbf{482\ 739\ 105}$$

### Key Formatting Principles

1. **Digits only (no letters)**:
   - Many Yen users are older and speak identifiers aloud over the phone in Hindi, English, and regional languages.
   - Letters create acoustic ambiguity over telephone audio (e.g. "B" vs "D", "M" vs "N", "P" vs "T", "S" vs "F", and vowel shifts between Hindi and English). Digits 0–9 are phonetically distinct across Indian languages.
2. **No leading zero**:
   - The first digit is always between $1$ and $9$ (`^[1-9][0-9]{8}$`).
   - If an identifier starts with `0`, common spreadsheet software (Microsoft Excel, Google Sheets, CSV exporters) automatically strips the leading zero, corrupting user data. Prohibiting leading zeros prevents data loss in financial reporting.
3. **Random, not sequential**:
   - Sequential IDs reveal user volume, sign-up timing, and account creation rates to observers. Yen IDs are generated using cryptographically secure random integers (`crypto.randomInt`).
   - The address space provides $9 \times 10^7 = 90,000,000$ possible identifiers, accommodating national scale while maintaining a short 9-digit length.
4. **Display requirement**:
   - The Yen ID is always displayed directly adjacent to the person's display name, never in isolation.

---

## 2. Check Digit: The Damm Algorithm

The final (9th) digit of every Yen ID is a check digit calculated using the **Damm algorithm** over the 8-digit random body.

### Mathematical Foundation

The Damm algorithm operates over a totally anti-symmetric quasigroup $(Q, *)$ of order 10 with weak total anti-symmetry and main diagonal zeros ($x * x = 0$):

- **H. Michael Damm's dissertation**: _"Total anti-symmetrische Quasigruppen"_, Philipps-Universität Marburg, 2004.
  [Dissertation Archive](https://archiv.ub.uni-marburg.de/diss/z2004/0516/)
- **Published journal paper**: H. Michael Damm, _"Totally anti-symmetric quasigroups for all orders $n \neq 2, 6$"_, _Discrete Mathematics_ 307 (2007) 715–729.
  [DOI: 10.1016/j.disc.2006.05.033](https://doi.org/10.1016/j.disc.2006.05.033)
- **Verified published test vector**: Input `572` yields check digit `4`; payload `5724` evaluates to `0`.

### Error Detection Capabilities

- **100% of single-digit transcription errors**: Any mistake where digit $a$ is mistyped as $b$ ($a \neq b$) in any of the 9 positions is detected.
- **100% of adjacent transposition errors**: Any transposition of adjacent characters $ab \to ba$ ($a \neq b$) across any of the 8 adjacent pairs is detected.
- **What it does NOT detect**:
  - Twin errors separated by other digits ($a \dots b \to b \dots a$ where $a$ and $b$ are not adjacent).
  - Phonetic slips spanning multiple syllables (e.g. swapping word blocks).
  - Two equal adjacent digits transposed ($aa \to aa$ is mathematically identical and excluded).

### Error Detection is NOT Cryptographic Security

> [!WARNING]
> The Damm check digit is an **error-detecting code**, not a cryptographic signature, MAC, or authentication credential.
> Anyone can calculate the valid check digit for any 8-digit number. A valid check digit proves only that the number was not mistyped; it does **not** prove that the ID exists, was issued by Yen, or belongs to any specific person.

---

## 3. Privacy & Storage Invariants

The Yen ID is **private account metadata**, intended solely for user profile viewing, authorized member invitations, and customer support.

### Invariants

1. **Assigned to the ACCOUNT, not the phone number**:
   - Bound to `users.id` (UUID), never to `users.phone`.
   - If a user changes their phone number or authenticates with a different SIM, their Yen ID remains unchanged.
2. **One per user, permanent forever**:
   - A user account receives exactly one Yen ID upon first assignment.
   - Idempotent and race-safe generation ensures 50 concurrent requests return the exact same identifier.
3. **Tombstone on account deletion (`ON DELETE SET NULL`)**:
   - When a user account is deleted or erased, foreign key `user_id REFERENCES users(id) ON DELETE SET NULL` retains the row in `yen_ids` with `user_id = NULL`.
   - Because `yen_id` is the `PRIMARY KEY`, no future account can ever receive that ID. Yen IDs are **never re-issued**.
4. **Strict exclusion from public records**:
   - **NEVER** recorded in the append-only event log (`fund_events`).
   - **NEVER** displayed on donation receipts, public audit proofs, or public fund ledger pages.
   - **NEVER** sufficient to log in (authentication requires phone OTP and PIN/device proof).

---

## 4. Enumeration Risk & Lookup Architecture

The "Add member by Yen ID" invite feature requires looking up account details given a 9-digit ID.

### Threat Model: ID Harvesting & Enumeration

With 90 million possible IDs and a 100% valid check digit rule, an attacker could iterate numbers, compute valid check digits, and harvest user names and active accounts.

### Defenses Implemented in `lookupYenId`

1. **Pre-lookup check digit validation**:
   - The Damm check digit is validated before any database query or rate limiter token consumption. Mistyped numbers never hit the database.
2. **Injected rate limiting (`viewerKey`)**:
   - Every lookup requires a successful token consumption via `RateLimiter.consume(viewerKey)`.
   - If the rate limit is exceeded, the function rejects with `RateLimitExceededError`.
   - **Uniform rejection**: To a rate-limited caller, an existing ID and a non-existent ID behave identically.
3. **Display name masking (`maskDisplayName`)**:
   - `lookupYenId` returns **ONLY** a masked display name (e.g. `Rahul Patel` -> `R**** P****`).
   - Phone numbers, user IDs, pseudonyms, and balances are never returned.
   - The masked name provides sufficient confirmation for human verification during an invite without disclosing full names to scrapers.
4. **Caller authorization obligation**:
   - `lookupYenId` does **not** evaluate viewer permissions or fund roles.
   - The calling layer (API route handler) is strictly responsible for verifying that the viewer is an active fund owner authorized to issue invitations.

---

## 5. Usage Example

```typescript
import { generateYenId, formatYenId, parseYenId, assignYenId, lookupYenId } from "@yen/identity";

// 1. Generate and format
const id = generateYenId();
console.log(formatYenId(id)); // "482 739 105"

// 2. Parse from user input (accepts spaces, dashes, Devanagari digits)
const parsed = parseYenId("४८२ ७३९ १०५");
if (parsed.ok) {
  console.log(parsed.value); // "482739105"
}

// 3. Assign to user account (Postgres)
const assignedId = await assignYenId(sql, userId);

// 4. Look up for invitation (rate limited, masked name)
const maskedName = await lookupYenId(sql, {
  yenId: "482 739 105",
  limiter: rateLimiter,
  viewerKey: "inviting-user-ip",
});
console.log(maskedName); // "R**** P****"
```
