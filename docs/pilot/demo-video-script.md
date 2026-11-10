# Pilot demo video script: 3 minutes, shot by shot

Status: pilot kit, YEN-51.

Audience: whoever records the pilot demo video. This script crosses three documents and stays
consistent with all of them: the journey specs in `docs/ux/five-core-journeys.md` (J1 to J5),
the recording procedure in `docs/runbooks/demo-recording.md`, and the support promises in
`docs/pilot/support-runbook.md`. Narration is written line by line in English and Hindi so the
same edit can ship in either language or both.

## Ground rules

- Total runtime: 180 seconds. Every shot below has a fixed window; if a take overruns, cut
  narration, not the honesty sentences. The sentences marked [honesty] are mandatory.
- Zero on-screen text promises that the app does not keep. If a component is simulated locally,
  the closer discloses it (section 6 of `docs/runbooks/demo-recording.md`).
- Record at 1440x900 or larger. One shot (shot 6) is recorded in a 390 px wide window to show
  the phone layout.
- The fund shown is the seeded demo fund; do not blur anything, the data is fictional.

## Pre-roll (never on camera)

Follow `docs/runbooks/demo-recording.md` exactly:

1. `pnpm demo:reset`, then `pnpm dev:full` (web on http://localhost:3000, API on
   http://localhost:3001).
2. Start the local ClamAV daemon and restart with `CLAMAV_HOST=localhost` so the bill upload
   works in shot 7.
3. Seed the browser session cookies and run the PIN setup calls for Aarav Sharma (treasurer),
   Priya Verma and Rohan Iyer (approvers) with recording PIN `482613`.
4. Prepare `assets/demo-fixtures/bill.jpg` (a real phone photo of a paper invoice).
5. Optional, for the anchored verify state in shot 10: local Anvil chain plus queue worker per
   section 8 of the runbook. Without it, shot 10 records the pending-seal state instead; both
   are honest, pick one and do not mix.

Seeded identifiers used below (from `packages/db/src/dev-seed.ts`):

| Thing                  | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Fund ID                | `01940000-0000-7000-8000-000000000002`                                             |
| Public fund URL        | `http://localhost:3000/funds/01940000-0000-7000-8000-000000000002`                 |
| Treasurer persona      | Aarav Sharma, cookie `yen_mock_session_treasurer_token`                            |
| Approver personas      | Priya Verma (`..._approver1_token`), Rohan Iyer (`..._approver2_token`, hi locale) |
| Backup pending expense | `01940000-0000-7000-8000-000000000062` (25,000 INR, batteries)                     |
