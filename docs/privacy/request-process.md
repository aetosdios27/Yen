# Data-principal requests

The product footer links `/privacy` (English and Hindi); its choices section names
`raypranav718@gmail.com` for correction, erasure, withdrawal and grievances.
The notice still needs review by a lawyer or mentor. The fund operator must arrange
and record that review; shipping tests does not constitute approval.

1. Record receipt, request type and an opaque case ID in the restricted support
   system. Never copy the contact into event logs, telemetry or public tickets.
2. Verify control of the account phone, or of the guest email/phone through a
   separate challenge. Never infer ownership from a display name. Limit staff access.
3. For an account, use authenticated `/v1/privacy/erasure-requests` with `dryRun`
   first, then execute. Explain any explicitly marked legal-retention exception.
   Correction uses the existing authenticated profile/display-name flows; verify the
   changed contact before moving any guest record to it.
4. For verified guest contact erasure, put the normalized contact in a private file
   readable only by the operator and run against the app database:

   ```sh
   pnpm --filter @yen/db privacy:erase-contact --verified-contact-file /private/contact.txt
   ```

   This atomically deletes subscriptions, waitlist entries and guest labels, and
   clears donor names/contacts from pledges so subsequent receipt rendering is anonymous.
   It preserves amounts and append-only events. Remove the private file afterwards.
   For correction, verify both contacts and update the identified mutable records
   transactionally; never rewrite historical events or identify unrelated namesakes.
5. Check source rows and receipt output, confirm completion, record only case ID,
   action, completion time and any justified retained categories. Escalate unresolved
   grievances to the named contact. Do not claim a legal response deadline without review.
6. Already downloaded receipts/exports and backups need operational handling:
   expire backups under deployment policy, restrict restores and replay completed
   erasures before serving restored data. A configured payment partner must receive
   applicable deletion/correction requests through its own process.

Automated retention runs daily in the queue worker. Review failures through queue
operations; `pnpm --filter @yen/db retention --dry-run` reports counts and the same
command without `--dry-run` applies the schedule immediately. The inventory lists
application defaults, not legally reviewed retention requirements.
