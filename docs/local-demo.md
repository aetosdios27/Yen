# Run the local demo

Use Node 24.21.0 (`.nvmrc`), pnpm 12.6.0 and Docker or Podman Compose.
From the repository root:

```sh
./start-demo.sh
```

The script installs locked dependencies, starts PostgreSQL and Redis, migrates
and seeds the local database, starts the local chain and web/API servers, then
verifies all three demo logins. Wait for **Demo logins verified** before opening
<http://localhost:3000/login>. Keep the terminal running; Ctrl+C stops the app
servers and worker. The database containers remain available for the next run.

If you deliberately want to demonstrate without blockchain anchoring:

```sh
./start-demo.sh --no-chain
```

New records remain pending in that mode. The normal command fails if the local
chain cannot start rather than silently presenting an incomplete demo.

| Person       | Role       | Phone         | Demo PIN |
| ------------ | ---------- | ------------- | -------- |
| Aarav Sharma | Treasurer  | +919876543210 | 482613   |
| Priya Verma  | Approver 1 | +919876543211 | 482613   |
| Rohan Iyer   | Approver 2 | +919876543212 | 482613   |

Click **Send code**. The development-only simulated OTP is filled in for you.
Verify it, then enter the demo PIN. Use separate browser profiles for each person;
tabs in one profile share the same session.

Every startup restores the three seeded demo accounts' PINs and clears their
PIN lockouts. It preserves financial records and other users' PINs. The script
rejects production/test mode, remote databases and occupied app ports before
restoring accounts. Stop an existing server first; it never kills it for you.
To use different local ports, set both `WEB_PORT` and `API_PORT`; the browser API
URL follows the selected API port.

## Complete an expense

1. Treasurer: open the fund dashboard and create an expense with its bill.
2. Each approver: sign in separately, open that expense and approve with the PIN.
3. Treasurer: the approved expense stays in **Expenses awaiting completion**.
   Its reservation still reduces **Spendable balance**. Open **View expense**.
4. After the bank transfer, upload its bank statement CSV under **Match the bank
   payment**. The existing statement importer matches the bank debit. Approval
   alone never marks the expense paid. A missing or mismatched debit leaves it
   unpaid and shows an explanation.

Use the supported statement format (for example HDFC):

```csv
Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance
16/11/2026,UPI/DR/612345678901/robu@ybl/Robu.in Innovation Labs,612345678901,16/11/2026,12500.00,,0.00
```

For a simulated demo, choose the current date and the exact amount/payee of your
approved expense. Use a new 12-digit reference. This is synthetic bank input,
not evidence of a real-world payment. Chain anchoring is a separate later step;
only the worker's confirmed result should be presented as anchored.
