# Email authentication: SPF, DKIM and DMARC

Yen sends transactional email (login OTP codes, notification digests) from its own domain. This guide defines the sender authentication policy for production and staging. Unauthenticated email is rejected or quarantined by recipient providers, and transactional OTP mail must not fail, so these records are mandatory before enabling the email channel in any environment.

## Domain layout

| Environment | Sending domain            | Notes                                               |
| ----------- | ------------------------- | --------------------------------------------------- |
| Production  | `yen.example.org`         | Primary organizational domain                       |
| Staging     | `staging.yen.example.org` | Dedicated subdomain, isolated reputation and policy |

Staging sends from a dedicated subdomain so that staging misbehavior (loops, test blasts, DMARC failures) never affects production deliverability. Each subdomain carries its own SPF, DKIM and DMARC records.

## SPF

SPF authorizes the hosts allowed to send for the domain. Keep exactly one SPF record per domain.

Production record on `yen.example.org`:

```
v=spf1 include:_spf.yen.example.org -all
```

Example include record, resolving to the mail provider's sending hosts:

```
_spf.yen.example.org. IN TXT "v=spf1 include:mailprovider.example.net -all"
```

Staging record on `staging.yen.example.org`:

```
v=spf1 include:mailprovider.example.net -all
```

Rules:

- End with `-all` (hard fail). Soft fail `~all` and neutral `?all` are not accepted for Yen domains.
- Keep the record under 10 DNS lookups. Flatten or split using an include subdomain if the provider requires more.
- Never list raw IP addresses unless the provider documents stable sending IPs; prefer the provider include.
- Verify with `dig TXT yen.example.org` after every change and with a checker such as the provider's validator before enabling the channel.

## DKIM

DKIM signs outgoing mail. Yen requires 2048-bit RSA keys (or provider-managed Ed25519 where supported) and a key per selector.

- Key size: 2048-bit RSA minimum. 1024-bit keys are not accepted; rotate immediately if an inherited key is smaller.
- Selectors: one selector per environment and signing key, for example `prod2026a` and `staging2026a`.
- Publication: publish the public key as a TXT record at `<selector>._domainkey.<sending domain>`.

Production example:

```
prod2026a._domainkey.yen.example.org. IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQ..."
```

Staging example:

```
staging2026a._domainkey.staging.yen.example.org. IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQ..."
```

Key handling:

- Generate keys with the provider tooling where possible so the private key never leaves the provider. If generated locally, use `openssl genrsa -out dkim_prod2026a.pem 2048` and transfer the private key into the secret manager directly; never commit it, paste it in chat, or send it by email.
- Grant the sending infrastructure access only; no human needs the private key.
- Rotate at least every 12 months, or immediately on suspected compromise. Publish the new key under a new selector, confirm signing with the new selector, then remove the old selector after a two week overlap.

## DMARC

DMARC tells receivers what to do when SPF and DKIM fail and gives Yen visibility through reports. Alignment requires the domain in the visible From header to match the SPF or DKIM authenticated domain. Yen requires aligned DKIM on every message; SPF alignment is a fallback.

Record on `yen.example.org`:

```
_dmarc.yen.example.org. IN TXT "v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:dmarc-reports@yen.example.org; sp=reject; pct=100"
```

Record on `staging.yen.example.org`:

```
_dmarc.staging.yen.example.org. IN TXT "v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:dmarc-reports@yen.example.org; sp=reject; pct=100"
```

Policy semantics:

- `p=reject` for both environments. New subdomains that have completed the rollout below may start at `p=quarantine` for one week, never at `p=none` in production.
- `adkim=s` strict DKIM alignment: the DKIM signing domain must equal the From domain. Staging signs with its own subdomain and sends From that same subdomain.
- `aspf=r` relaxed SPF alignment is sufficient because DKIM is the primary pass.
- `rua` aggregate reports go to a monitored mailbox or a DMARC report processor. Review weekly during rollout and at least monthly afterwards.
- `sp=reject` prevents subdomains of the sending domain from being used for spoofing.

Rollout for a domain that has never carried a DMARC record:

1. Publish `p=quarantine; pct=10` with `rua`. Confirm legitimate OTP and notification mail passes DKIM alignment.
2. Raise `pct` to 100 after one clean week of reports.
3. Move to `p=reject` after two clean weeks. Keep the quarantine step only for domains with third-party senders that cannot align.

## Staging sender configuration

- Send From `notifications@staging.yen.example.org`; OTP mail uses `auth@staging.yen.example.org` where a separate From identity is needed.
- Configure the SMTP transport with the staging credentials and staging selector only. Staging must never fall back to production credentials, and the `From` domain must always match the environment domain for DMARC alignment.
- SPF include, DKIM selector and DMARC records for the staging subdomain are provisioned with the same automation as production but as separate records.
- Staging recipient lists must contain seeded or opted-in addresses only; treat bounce and complaint events on staging as defects, not noise.

## Verification checklist

1. `dig TXT <sending domain>` returns exactly one SPF record ending in `-all`.
2. `dig TXT <selector>._domainkey.<sending domain>` returns the 2048-bit DKIM public key.
3. `dig TXT _dmarc.<sending domain>` returns the DMARC record with `p=reject` (or the documented quarantine rollout step).
4. Send a test OTP to a seeded external mailbox and confirm `Authentication-Results` shows `spf=pass`, `dkim=pass` aligned with the From domain, and `dmarc=pass`.
5. Confirm DMARC aggregate reports are arriving at the `rua` address.
