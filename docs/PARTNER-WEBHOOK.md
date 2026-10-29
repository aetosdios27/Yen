# Partner reconciliation webhook

The bank partner must authenticate each call to
`POST /v1/reconciliation/webhooks/partner` with an HMAC-SHA256 signature.
YEN-7 has not selected the production partner yet; this is the integration
contract until the partner-specific adapter is agreed.

## Request signing

Use `PARTNER_WEBHOOK_SECRET` as the shared key. Encode the timestamp as Unix
seconds in base 10 and send it as `X-Yen-Timestamp`. Compute the signature over
the exact UTF-8 request body bytes, without parsing or re-serializing JSON:

```text
message = timestamp + "." + raw_request_body
signature = HMAC-SHA256(secret, message)
```

Send the lowercase hexadecimal digest with the `v1=` prefix in
`X-Yen-Signature`. For example, the header shape is `v1=<64 lowercase hex
characters>`; the digest itself must be calculated from the actual timestamp
and body and must not be copied from an example.

The API allows a five-minute timestamp difference by default. The operator may
configure `PARTNER_WEBHOOK_TOLERANCE_SECONDS` from 1 to 3600 seconds. Keep the
partner clock synchronized. Each authenticated signature, timestamp, and body
hash tuple is accepted once, so a retry must use a new timestamp and signature;
the bank reference remains the transaction-level idempotency key.

## Secret rotation and limits

Set `PARTNER_WEBHOOK_SECRET` in every production API environment. Production
startup fails when it is missing. To rotate, deploy the new key as
`PARTNER_WEBHOOK_SECONDARY_SECRET`, switch the sender to it, and then deploy it
as the primary while removing the old key. During the overlap the API accepts
signatures from either configured key. Never put either value, the signature,
or the request body in logs or support tickets.

The body limit is 64 KiB and this route consumes the shared per-IP rate limit.
An unset key outside production makes webhook requests return `503` and does
not ingest them.
