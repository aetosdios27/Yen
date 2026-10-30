export interface paths {
  "/v1/waitlist": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["joinWaitlist"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Liveness */
    get: operations["health"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/version": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Build version */
    get: operations["version"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/ready": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Readiness */
    get: operations["ready"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/me": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Auth seam: returns only an injected dev/test principal until YEN-22. */
    get: operations["getMe"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/privacy/consents": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPrivacyConsents"];
    put?: never;
    post: operations["updatePrivacyConsent"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/privacy/erasure-requests": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["requestErasure"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/privacy/funds/{fundId}/retention-required": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["markRetentionRequired"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/otp/send": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Send a 6-digit OTP through the selected WhatsApp or SMS channel; no fallback occurs. */
    post: operations["sendOtp"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/otp/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Verify a 6-digit OTP, authenticate or register the user, and issue an httpOnly session cookie. */
    post: operations["verifyOtp"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/session/rotate": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Rotates the active session token, invalidating the previous token. */
    post: operations["rotateSession"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Lists active sessions and devices for the authenticated user. */
    get: operations["getSessions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device/lock": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Ends the unlocked period for the current trusted device. */
    post: operations["lockTrustedDevice"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/logout": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Revokes current session and clears session cookie. */
    post: operations["logout"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/logout-all": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Revokes all sessions across all devices for the authenticated user. */
    post: operations["logoutAll"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/sessions/{sessionId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** @description Revokes a specific session belonging to the authenticated user. */
    delete: operations["revokeSession"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description STUB: creates an in-memory fake fund. Data is lost on restart. Requires Idempotency-Key; identical method, URL, content type and body bytes replay. A changed request or an in-progress duplicate returns 409. Money is nonnegative integer paise encoded as canonical decimal strings. */
    post: operations["createFund"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description STUB: reads a fake fund created in this process by the same principal. Invalid canonical FundId, missing fund, or policy denial returns 404 to conceal existence. */
    get: operations["getFund"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/visibility": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /** @description Changes fund visibility using an optimistic version and records the v2 audit event. */
    put: operations["changeFundVisibility"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/summary": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPublicFundSummary"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/breakdown": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPublicFundBreakdown"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/timeline": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPublicFundTimeline"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/audit-bundle": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPublicAuditBundle"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/records/{recordId}/proof": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPublicRecordProof"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/expenses/{expenseId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Reads a policy-redacted expense detail for a fund tier. Anonymous public views receive no free-text identity fields. */
    get: operations["getPublicExpenseDetail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/expenses/{expenseId}/proofs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Reads filename-free evidence metadata. Verified bill bytes are returned only to donor and member tiers. */
    get: operations["getPublicExpenseProofs"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Lists expense requests for a fund. */
    get: operations["listExpenses"];
    put?: never;
    /** @description Creates a new draft expense request for a fund. Money is nonnegative integer paise encoded as decimal string. Requires Idempotency-Key. */
    post: operations["createExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Reads an expense request. Unauthorized requests return 404. */
    get: operations["getExpense"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/submit": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Submits a draft expense request, creating a ledger hold to reserve funds. Transitions draft -> submitted. Emits expense.submitted event. */
    post: operations["submitExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/approve": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Approves an expense spend request. Requires 6-digit approval PIN verification or valid approval token bound to this action. */
    post: operations["approveExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/reject": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Rejects an expense spend request. Requires 6-digit approval PIN verification or valid approval token bound to this action. */
    post: operations["rejectExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/pay": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Commits/settles the ledger hold for an approved expense after payment. Transitions approved -> paid. Emits expense.paid event. */
    post: operations["payExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/reconcile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Reconciles a paid expense against bank debit verification. Transitions paid -> reconciled. Emits bank.debit_seen event. */
    post: operations["reconcileExpense"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/alerts": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Lists alerts for a fund, newest first. Fund members only. */
    get: operations["listFundAlerts"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/alerts/{alertId}/acknowledge": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Acknowledges an open alert with a required note. Fund owners and approvers only. */
    post: operations["acknowledgeAlert"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/alerts/{alertId}/resolve": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Resolves an open or acknowledged alert with a required note. Resolved alerts cannot be reopened. Fund owners and approvers only. */
    post: operations["resolveAlert"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/donation-details": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Public where-to-pay details for a fund: its UPI ID and the name to show the donor. Anyone may read them; an unknown or closed fund returns 404. */
    get: operations["getDonationDetails"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/donations/pledge": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Records a donor's self-reported UPI payment. The money is not spendable until a bank statement confirms it, and one 12-digit reference can only be claimed once, so a repeat returns 409. Requires Idempotency-Key; identical requests replay. */
    post: operations["pledgeDonation"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/receipts/{receiptId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Retrieves public verified donation certificate and receipt details for a donor by either donation pledge UUID or 12-digit UTR. Works without login and reveals only that donor's own donation. */
    get: operations["getReceipt"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/receipts/{receiptId}/pdf": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Downloads printable PDF-1.4 donor donation receipt with QR code, bilingual non-80G disclaimers, and verification link. */
    get: operations["getReceiptPdf"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/receipts/{receiptId}/svg": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Retrieves vector SVG donor donation receipt certificate with QR code and bilingual non-80G disclaimers. */
    get: operations["getReceiptSvg"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/subscriptions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Subscribes a donor or supporter to periodic fund updates (weekly summary from events, instant alerts for objections or large expenses). Protected against PII leakage in responses. */
    post: operations["createSubscription"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/subscriptions/unsubscribe": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Validates an unsubscribe token without mutating subscription state, preventing accidental unsubscribe by mail scanner prefetchers. Requires confirmation via POST to complete unsubscribe. */
    get: operations["unsubscribeGet"];
    put?: never;
    /** @description Honors one-tap unsubscribe immediately using the 64-character unguessable token included in every notification. */
    post: operations["unsubscribe"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/payee": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /** @description Changes an expense payee. Requires a PIN or one-use approval token and re-evaluates payee fraud rules. */
    put: operations["changeExpensePayee"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/fraud-acknowledgements": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Records an owner's reasoned acknowledgement for a blocking payee fraud flag. */
    post: operations["acknowledgeExpenseFraudFlag"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/members/{pseudonymId}/payee-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /** @description Sets the caller's payee fingerprint, or an officeholder's fingerprint by an owner. The normalized identifier is never returned. */
    put: operations["setMemberPayeeProfile"];
    post?: never;
    /** @description Clears the caller's payee fingerprint, or an officeholder's fingerprint by an owner. */
    delete: operations["clearMemberPayeeProfile"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/payee-rules/policy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /** @description Configures per-fund payee-fraud thresholds and the flags that block approval. Owner only. */
    put: operations["updatePayeeRulesPolicy"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/invites": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listOwnerInvites"];
    put?: never;
    post: operations["createOwnerInvite"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/invites/{inviteId}/confirm": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["confirmOwnerInvite"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/invites/redeem": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["redeemOwnerInvite"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/setup": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Sets the 6-digit approval PIN for the principal before first approval action. */
    post: operations["setupApprovalPin"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device/unlock": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Reauthenticates a phone-verified session with the Yen PIN and binds or refreshes its trusted-device record. */
    post: operations["unlockTrustedDevice"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/status": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Returns the approval PIN status for the principal. */
    get: operations["getApprovalPinStatus"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Verifies the 6-digit approval PIN against a specific action hash and issues a single-use 60-second approval token. */
    post: operations["verifyApprovalPin"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/change": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Changes the approval PIN given the verified current PIN. */
    post: operations["changeApprovalPin"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/reset/request": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Requests an OTP to reset a forgotten or locked PIN. */
    post: operations["requestPinReset"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/reset/confirm": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Confirms PIN reset with OTP, setting a 24-hour cooling-off during which approval actions are blocked. */
    post: operations["confirmPinReset"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/pin/unlock": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Allows an authorized administrator or recovery capability to unlock a locked-out approver PIN. */
    post: operations["unlockApprovalPin"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/payee": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Changes the club's payee UPI ID. Requires 6-digit approval PIN verification. */
    post: operations["changeFundPayee"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/policy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Changes the fund approval policy. Requires 6-digit approval PIN verification. */
    post: operations["changeFundPolicy"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/members": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Adds a new member or approver to the fund. Requires 6-digit approval PIN verification. */
    post: operations["addFundMember"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/members/{memberId}/remove": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Removes a member from the fund. Requires 6-digit approval PIN verification. */
    post: operations["removeFundMember"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/evidence": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Retrieves evidence attached to an expense after verifying stored bytes against their pinned SHA-256 hashes. */
    get: operations["getEvidence"];
    put?: never;
    /** @description Uploads bill or receipt evidence after malware scanning. Computes SHA-256 server-side, validates GSTIN and MIME type, enforces the 10MB limit, and detects duplicates within the fund. Scanner errors and infected files fail closed. */
    post: operations["uploadEvidence"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reconciliation/statements": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Upload bank statement CSV
     * @description Uploads and ingests a bank statement CSV for reconciliation against pending donation pledges.
     */
    post: operations["uploadStatement"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reconciliation/webhooks/partner": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Payment partner webhook
     * @description Idempotent webhook receiver for payment partner notifications (e.g. UPI virtual account credit). Requests must carry `X-Webhook-Timestamp` (Unix seconds, within five minutes of server time) and `X-Webhook-Signature`, the lowercase hex HMAC-SHA256 of `v1.<timestamp>.<raw body>` under the shared partner secret. Unsigned, stale, future-dated, or tampered requests are rejected with 401 before the body is parsed.
     */
    post: operations["partnerWebhook"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/reconciliation/unmatched": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Treasurer review queue for unmatched credits
     * @description Lists unmatched bank credits for a fund with potential matching candidate pledges for treasurer review.
     */
    get: operations["getUnmatchedCredits"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/reconciliation/manual-match": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Treasurer manual reconciliation match
     * @description Manually matches an unmatched bank transaction with a donation pledge with mandatory audit reason.
     */
    post: operations["manualMatch"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/debit-review": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List unapproved and ambiguous bank debits */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          fundId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Debit review items */
        200: {
          headers: {
            /** @description Request correlation ID */
            "x-request-id": string;
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              items: {
                /** @enum {string} */
                kind: "unapproved" | "ambiguous";
                /** Format: uuid */
                bankTransactionId: string;
                bankReference: string;
                amountPaise: number;
                /** Format: date-time */
                postedAt: string;
                counterpartyVpa?: string;
                counterpartyAccountFingerprint?: string;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/debit-review/{bankTransactionId}/resolve": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Resolve an unapproved debit with an audit reason */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          fundId: string;
          bankTransactionId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            reason: string;
          };
        };
      };
      responses: {
        /** @description Resolved */
        200: {
          headers: {
            /** @description Request correlation ID */
            "x-request-id": string;
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              resolved: true;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/debit-review/{bankTransactionId}/match": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Manually match a debit to an approved expense */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          fundId: string;
          bankTransactionId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: uuid */
            expenseId: string;
            reason: string;
          };
        };
      };
      responses: {
        /** @description Debit manually matched */
        200: {
          headers: {
            /** @description Request correlation ID */
            "x-request-id": string;
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              matched: true;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/debit-review/{bankTransactionId}/unmatch": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Mark an ambiguous debit as unapproved with an audit reason */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          fundId: string;
          bankTransactionId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            reason: string;
          };
        };
      };
      responses: {
        /** @description Debit moved to unapproved review */
        200: {
          headers: {
            /** @description Request correlation ID */
            "x-request-id": string;
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              unmatched: true;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/public/expenses/{expenseId}/objections": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listExpenseObjections"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/objections": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["raiseExpenseObjection"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/funds/{fundId}/expenses/{expenseId}/objections/{objectionId}/resolve": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["resolveExpenseObjection"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-credentials/registration/options": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates a one-minute WebAuthn registration challenge for the signed-in user. */
    post: operations["createDeviceCredentialRegistrationOptions"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-credentials/registration/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Registers a device credential after fresh Yen PIN verification. */
    post: operations["registerDeviceCredential"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-credentials": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Lists the signed-in user's device credentials, including revoked entries. */
    get: operations["listDeviceCredentials"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-credentials/{credentialId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** @description Revokes one device credential owned by the signed-in user. */
    delete: operations["revokeDeviceCredential"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-signatures/options": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates a one-minute WebAuthn assertion challenge bound to an exact action hash. */
    post: operations["createDeviceSignatureOptions"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/auth/device-signatures/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Verifies a device assertion and returns a one-use, 60-second proof bound to the action hash. */
    post: operations["verifyDeviceSignature"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/openapi.json": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getOpenApi"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/delivery/webhooks/meta": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Verify the Meta delivery webhook endpoint */
    get: operations["verifyMetaDeliveryWebhook"];
    put?: never;
    /** Receive Meta WhatsApp delivery status events */
    post: operations["receiveMetaDeliveryStatusWebhook"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/delivery/webhooks/exotel": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Receive an HMAC-signed Exotel SMS callback from the configured relay */
    post: operations["receiveExotelRelayDeliveryStatusWebhook"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    ErrorEnvelope: {
      error: {
        /** @enum {string} */
        code:
          | "validation_failed"
          | "unauthenticated"
          | "forbidden"
          | "not_found"
          | "conflict"
          | "idempotency_conflict"
          | "donation_utr_claimed"
          | "rate_limited"
          | "overloaded"
          | "payload_too_large"
          | "internal"
          | "gateway_timeout";
        message: string;
        /** Format: uuid */
        requestId: string;
        details?: {
          path: (string | number)[];
          message: string;
        }[];
      };
    };
    WaitlistInput: {
      name: string;
      /** @description Email address, international phone in + digits form, or Indian 10-digit mobile number with optional spaces or hyphens. */
      contact: string;
      org: string;
      /** @enum {string} */
      locale: "en" | "hi";
      consent: {
        /** @enum {boolean} */
        accepted: true;
        text: string;
        version: string;
      };
    };
    Version: {
      gitSha: string;
      buildId: string;
      artifactDigest: string;
      releaseTag: string;
      provenanceUrl: string;
    };
    Principal: {
      /** Format: uuid */
      id: string;
      phone?: string;
      displayName?: string;
      locale?: string;
    };
    SendOtpResponse: {
      /** @enum {string} */
      status: "sent";
      /** @enum {string} */
      channel: "whatsapp" | "sms";
      resendAfterSeconds: number;
      /** Format: date-time */
      expiresAt: string;
    };
    SendOtpInput: {
      /** @description Phone number (E.164 or 10-digit Indian mobile) */
      phone: string;
      /**
       * @description Selected delivery channel; delivery never switches channels
       * @enum {string}
       */
      channel: "whatsapp" | "sms";
    };
    VerifyOtpResponse: {
      /** @enum {string} */
      status: "authenticated";
      session: components["schemas"]["AuthSession"];
    };
    AuthSession: {
      /** Format: uuid */
      id: string;
      token: string;
      /** Format: date-time */
      expiresAt: string;
      user: components["schemas"]["AuthUser"];
    };
    AuthUser: {
      /** Format: uuid */
      id: string;
      phone: string;
      displayName: string;
      locale: string;
    };
    VerifyOtpInput: {
      /** @description Phone number (E.164 or 10-digit Indian mobile) */
      phone: string;
      /** @description 6-digit OTP code */
      code: string;
    };
    RotateSessionResponse: {
      /** @enum {string} */
      status: "rotated";
      session: {
        /** Format: uuid */
        id: string;
        token: string;
        /** Format: date-time */
        expiresAt: string;
      };
    };
    ListSessionsResponse: {
      sessions: components["schemas"]["SessionItem"][];
    };
    SessionItem: {
      /** Format: uuid */
      id: string;
      deviceInfo: string;
      ip: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      lastActiveAt: string;
      isCurrent: boolean;
    };
    Fund: {
      name: string;
      purpose?: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      targetPaise: string;
      upiVpa: string;
      upiPayeeName: string;
      /** @enum {string} */
      visibility: "public" | "donors" | "members" | "private";
      version?: number;
      /** Format: uuid */
      id: string;
      /** Format: date-time */
      createdAt: string;
    };
    CreateFund: {
      name: string;
      purpose?: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      targetPaise: string;
      upiVpa: string;
      upiPayeeName: string;
      /** @enum {string} */
      visibility?: "public" | "donors" | "members" | "private";
    };
    PublicExpenseDetail: {
      /** Format: uuid */
      expenseId: string;
      /** Format: uuid */
      fundId: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      category: string;
      /** @enum {string} */
      status: "draft" | "submitted" | "approved" | "rejected" | "expired" | "paid" | "reconciled";
      payeeName?: string;
      requesterDisplayName?: string;
      description?: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
    };
    PublicExpenseProofs: {
      /** Format: uuid */
      expenseId: string;
      proofs: components["schemas"]["PublicExpenseProof"][];
    };
    PublicExpenseProof: {
      sha256: string;
      /** @enum {string} */
      scanStatus: "clean" | "infected" | "unavailable";
      /** @enum {string} */
      mimeType?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
      contentBase64?: string;
    };
    Expense: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      fundId: string;
      requesterId: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** @enum {string} */
      category: "Equipment" | "Travel" | "Catering" | "Logistics" | "Facilities" | "Other";
      description: string;
      recipientRef: string;
      payee?: {
        identity:
          | {
              /** @enum {string} */
              kind: "upi";
              vpa: string;
            }
          | {
              /** @enum {string} */
              kind: "bank";
              account: string;
              ifsc: string;
            };
        name: string;
        gstin?: string;
        verification: {
          /** @enum {string} */
          status: "unverified" | "verified" | "failed";
          provider?: string;
          reference?: string;
          /** Format: date-time */
          verifiedAt?: string;
        };
      } | null;
      fraudFlags?: {
        /** @enum {string} */
        code:
          | "new_payee_large_first_payment"
          | "payee_changed_cooling_off"
          | "self_payment"
          | "split_requests"
          | "duplicate_invoice"
          | "duplicate_evidence"
          | "gstin_name_mismatch"
          | "payee_velocity";
        reason: string;
      }[];
      fraudAcknowledgements?: {
        /** @enum {string} */
        code:
          | "new_payee_large_first_payment"
          | "payee_changed_cooling_off"
          | "self_payment"
          | "split_requests"
          | "duplicate_invoice"
          | "duplicate_evidence"
          | "gstin_name_mismatch"
          | "payee_velocity";
        actorPseudonym: string;
        reason: string;
        /** Format: date-time */
        acknowledgedAt: string;
      }[];
      status: components["schemas"]["ExpenseStatus"];
      holdId: string | null;
      approvalsCount: number;
      objectionWindowOpen?: boolean;
      /** Format: uuid */
      supersedesId: string | null;
      /** Format: date-time */
      submittedAt: string | null;
      /** Format: date-time */
      approvedAt: string | null;
      /** Format: date-time */
      rejectedAt: string | null;
      /** @enum {string|null} */
      rejectionReason: "quorum" | "objection" | "policy" | null;
      /** Format: date-time */
      expiredAt: string | null;
      /** Format: date-time */
      paidAt: string | null;
      /** Format: date-time */
      reconciledAt: string | null;
      /** Format: uuid */
      bankTransactionId: string | null;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
    };
    /** @enum {string} */
    ExpenseStatus:
      | "draft"
      | "submitted"
      | "approved"
      | "rejected"
      | "expired"
      | "paid"
      | "reconciled";
    CreateExpenseInput: {
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** @enum {string} */
      category?: "Equipment" | "Travel" | "Catering" | "Logistics" | "Facilities" | "Other";
      description: string;
      recipientRef: string;
      payee?: {
        identity:
          | {
              /** @enum {string} */
              kind: "upi";
              vpa: string;
            }
          | {
              /** @enum {string} */
              kind: "bank";
              account: string;
              ifsc: string;
            };
        name: string;
        gstin?: string;
      };
      invoiceNumber?: string;
      evidence?: components["schemas"]["ExpenseEvidence"][];
      /** Format: uuid */
      supersedesId?: string;
    };
    ExpenseEvidence: {
      /** Format: uuid */
      evidenceId: string;
      contentSha256: string;
    };
    ExpenseApprovalResponse: {
      /** @enum {string} */
      status: "submitted" | "approved";
      /** Format: uuid */
      expenseId: string;
      /** Format: date-time */
      approvedAt: string | null;
      approvalsCount?: number;
    };
    ExpenseApprovalInput: {
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
      /** Format: uuid */
      deviceProof?: string;
      credentialId?: string;
      signatureHex?: string;
      clientDataJson?: string;
      authenticatorDataHex?: string;
    };
    ExpenseRejectionResponse: {
      /** @enum {string} */
      status: "rejected";
      /** Format: uuid */
      expenseId: string;
      reason: string;
      /** Format: date-time */
      rejectedAt: string;
    };
    ExpenseRejectionInput: {
      /**
       * @default policy
       * @enum {string}
       */
      reason: "quorum" | "objection" | "policy";
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
      /** Format: uuid */
      deviceProof?: string;
    };
    PayExpenseInput: {
      /** Format: uuid */
      bankTransactionId: string;
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
      /** Format: uuid */
      deviceProof?: string;
    };
    ReconcileExpenseInput: {
      /** Format: uuid */
      bankTransactionId: string;
    };
    FundAlert: {
      /** Format: uuid */
      id: string;
      /** @enum {string} */
      alertType:
        | "unapproved_debit"
        | "balance_drift"
        | "chain_verification_failure"
        | "anchor_missing"
        | "anchor_mismatch"
        | "repeated_rejected_requests"
        | "spend_rate_spike"
        | "integrity_check_failure";
      /** @enum {string} */
      severity: "info" | "warning" | "critical";
      /** @enum {string} */
      status: "open" | "acknowledged" | "resolved";
      title: string;
      details: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      acknowledgedAt: string | null;
      /** Format: date-time */
      resolvedAt: string | null;
      /** Format: date-time */
      escalatedAt: string | null;
    };
    AlertNoteInput: {
      note: string;
    };
    DonationDetails: {
      /** Format: uuid */
      fundId: string;
      title: string;
      upiVpa: string;
      upiPayeeName: string;
    };
    DonationPledgeResult: {
      /** Format: uuid */
      donationId: string;
      /** Format: uuid */
      fundId: string;
      /** @enum {string} */
      status: "pledged";
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
    };
    DonationPledge: {
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** @description The 12-digit reference shown in the donor's UPI app */
      utr: string;
      donorName?: string;
      /** @description Email address, international phone in + digits form, or Indian 10-digit mobile number with optional spaces or hyphens. */
      donorContact?: string;
      /**
       * @default initials
       * @enum {string}
       */
      donorNameChoice: "full" | "initials" | "anonymous";
    };
    DonorReceipt: {
      /** Format: uuid */
      donationId: string;
      /** Format: uuid */
      fundId: string;
      fundName: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      utr: string;
      donorDisplayName?: string;
      /** @enum {string} */
      donorNameChoice?: "full" | "initials" | "anonymous";
      /** @enum {string} */
      status: "pledged" | "verified" | "rejected";
      createdAt: string;
      verifiedAt?: string;
      proofUrl?: string;
      onChainRoot?: string;
      onChainTxHash?: string;
      /** @enum {boolean} */
      isTaxReceipt: false;
      disclaimerEn: string;
      disclaimerHi: string;
    };
    FundSubscription: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      fundId: string;
      /** @enum {string} */
      channel: "email" | "whatsapp" | "sms";
      weeklySummary: boolean;
      instantAlerts: boolean;
      /** @enum {string} */
      status: "active" | "unsubscribed";
      createdAt: string;
    };
    CreateFundSubscriptionInput: {
      /** @description Phone number (E.164 or 10-digit Indian mobile) or email address */
      contact: string;
      /** @enum {string} */
      contactType: "email" | "phone";
      /**
       * @default whatsapp
       * @enum {string}
       */
      channel: "email" | "whatsapp" | "sms";
      /** @default true */
      weeklySummary: boolean;
      /** @default true */
      instantAlerts: boolean;
    };
    UnsubscribeResult: {
      success: boolean;
      /** Format: uuid */
      fundId: string;
      /** @enum {string} */
      status: "unsubscribed";
      unsubscribedAt: string;
    };
    UnsubscribeInput: {
      token: string;
    };
    UnsubscribeStatusResult: {
      success: boolean;
      /** Format: uuid */
      fundId: string;
      /** @enum {string} */
      status: "active" | "unsubscribed";
      /** @enum {boolean} */
      requiresConfirmation: true;
    };
    PinSetupResponse: {
      /** @enum {string} */
      status: "created";
      /** @enum {boolean} */
      isSet: true;
    };
    PinSetupInput: {
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin: string;
    };
    UnlockTrustedDeviceResponse: {
      /** @enum {string} */
      status: "unlocked";
    };
    UnlockTrustedDeviceInput: {
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin: string;
    };
    PinStatus: {
      isSet: boolean;
      /** @enum {string} */
      status: "not_set" | "active" | "locked_out" | "cooling_off" | "rate_limited";
      lockedUntil?: string | null;
      coolingOffUntil?: string | null;
      failedAttempts?: number;
    };
    VerifyPinResponse: {
      /** Format: uuid */
      approvalToken: string;
      /** Format: date-time */
      expiresAt: string;
    };
    VerifyPinInput: {
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin: string;
      actionHash: string;
    };
    ChangePinResponse: {
      /** @enum {string} */
      status: "updated";
    };
    ChangePinInput: {
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      currentPin: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      newPin: string;
    };
    ResetPinRequestResponse: {
      /** @enum {string} */
      status: "otp_sent";
      /** Format: uuid */
      challengeId: string;
    };
    ResetPinRequestInput: {
      /** @enum {string} */
      channel: "whatsapp" | "sms";
    };
    ResetPinConfirmResponse: {
      /** @enum {string} */
      status: "cooling_off";
      /** Format: date-time */
      coolingOffUntil: string;
    };
    ResetPinConfirmInput: {
      otp: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      newPin: string;
      /** Format: uuid */
      challengeId?: string;
    };
    UnlockPinResponse: {
      /** @enum {string} */
      status: "unlocked";
    };
    UnlockPinInput: {
      /** Format: uuid */
      targetUserId: string;
    };
    PayeeChangeResponse: {
      /** @enum {string} */
      status: "updated";
      vpa: string;
    };
    PayeeChangeInput: {
      vpa: string;
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
    };
    PolicyChangeResponse: {
      /** @enum {string} */
      status: "updated";
      policyJson: {
        [key: string]: unknown;
      };
    };
    PolicyChangeInput: {
      policyJson: {
        [key: string]: unknown;
      };
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
    };
    AddMemberResponse: {
      /** @enum {string} */
      status: "added";
      /** Format: uuid */
      memberId: string;
      role: string;
    };
    AddMemberInput: {
      /** Format: uuid */
      userId: string;
      /** @enum {string} */
      role: "approver" | "treasurer" | "member";
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
    };
    RemoveMemberResponse: {
      /** @enum {string} */
      status: "removed";
      /** Format: uuid */
      memberId: string;
    };
    RemoveMemberInput: {
      /** Format: uuid */
      approvalToken?: string;
      /**
       * @description 6-digit Yen approval PIN
       * @example 482915
       */
      pin?: string;
    };
    UploadEvidenceInput: {
      /**
       * Format: binary
       * @description Evidence document (max 10MB; JPEG, PNG, WebP, PDF)
       */
      file?: string;
      /** @description Optional merchant or vendor name */
      vendorName?: string;
      /** @description Optional 15-character Indian GSTIN; validated by the API */
      gstin?: string;
      /** @description Optional invoice or receipt reference number */
      invoiceNumber?: string;
      /** @description Optional invoice issue date (YYYY-MM-DD) */
      invoiceDate?: string;
    };
    StatementUploadResult: {
      totalProcessed: number;
      ingestedCount: number;
      matchedCount: number;
      unmatchedCount: number;
      duplicateCount: number;
      transactions: components["schemas"]["StatementTransactionSummary"][];
    };
    StatementTransactionSummary: {
      id: string;
      bankReference: string;
      utr?: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** @enum {string} */
      type: "credit" | "debit";
      /** @enum {string} */
      reconciliationStatus: "unmatched" | "matched" | "manually_matched" | "ignored" | "ambiguous";
      matchedPledgeId?: string;
      duplicate?: boolean;
    };
    StatementUploadInput: {
      /** Format: uuid */
      fundId: string;
      csvContent: string;
    };
    PartnerWebhookResult: {
      /** @enum {string} */
      status: "processed";
      duplicate?: boolean;
      transactionId: string;
      /** @enum {string} */
      reconciliationStatus: "unmatched" | "matched" | "manually_matched" | "ignored" | "ambiguous";
      matchedPledgeId?: string;
    };
    PartnerWebhookInput: {
      event: string;
      /** Format: date-time */
      timestamp: string;
      data: {
        /** Format: uuid */
        fund_id: string;
        bank_reference: string;
        amount_paise: number | string;
        /**
         * @default credit
         * @enum {string}
         */
        type: "credit" | "debit";
        /** Format: date-time */
        posted_at: string;
        utr?: string;
        narration?: string;
        counterparty?: {
          vpa?: string;
          name?: string;
        };
      } & {
        [key: string]: unknown;
      };
    };
    UnmatchedCreditsResponse: components["schemas"]["UnmatchedCredit"][];
    UnmatchedCredit: {
      id: string;
      /** Format: uuid */
      fundId: string;
      bankReference: string;
      utr?: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** Format: date-time */
      postedAt: string;
      narration?: string;
      counterpartyVpa?: string;
      candidates: components["schemas"]["CandidatePledge"][];
    };
    CandidatePledge: {
      pledgeId: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      utr: string;
      donorName?: string;
      /** Format: date-time */
      createdAt: string;
      timeDifferenceHours: number;
    };
    ManualMatchResult: {
      /** @enum {string} */
      status: "matched";
      bankTransactionId: string;
      pledgeId: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      amountPaise: string;
      /** Format: date-time */
      matchedAt: string;
    };
    ManualMatchInput: {
      /** @description ID of the unmatched bank transaction */
      bankTransactionId: string;
      /** @description ID of the pledge to match */
      pledgeId: string;
      /** @description Audit reason for manual match by treasurer */
      reason: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  joinWaitlist: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WaitlistInput"];
      };
    };
    responses: {
      /** @description Submission received */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "received";
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Request body too large */
      413: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  health: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is alive */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "ok";
            /** @description One entry per probed dependency, so a degraded dependency is named */
            checks: {
              name: string;
              /** @enum {string} */
              status: "ok" | "fail" | "skipped";
            }[];
          };
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description A recorded runtime fault or a shutdown in progress */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  version: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Source commit, deterministic build identifier, and optional release metadata */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Version"];
        };
      };
    };
  };
  ready: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Dependencies are ready */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "ok";
            /** @description One entry per probed dependency, so a degraded dependency is named */
            checks: {
              name: string;
              /** @enum {string} */
              status: "ok" | "fail" | "skipped";
            }[];
          };
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Dependency unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current principal */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Principal"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPrivacyConsents: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current and historical purpose-specific consent records */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            consents: {
              /** @enum {string} */
              purpose:
                | "account_otp"
                | "donation_receipt_contact"
                | "notification_whatsapp"
                | "notification_sms"
                | "notification_email";
              noticeVersion: string;
              /** Format: date-time */
              grantedAt: string;
              /** Format: date-time */
              withdrawnAt: string | null;
            }[];
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  updatePrivacyConsent: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": {
          /** @enum {string} */
          purpose:
            | "account_otp"
            | "donation_receipt_contact"
            | "notification_whatsapp"
            | "notification_sms"
            | "notification_email";
          /** @enum {string} */
          action: "grant" | "withdraw";
        };
      };
    };
    responses: {
      /** @description Consent recorded or withdrawn */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "ok";
            noticeVersion: string;
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  requestErasure: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": {
          /** @default false */
          dryRun?: boolean;
        };
      };
    };
    responses: {
      /** @description Erasure preview or completed request */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "preview" | "completed";
            retained: boolean;
            wouldErase: {
              [key: string]: number;
            };
            wouldRetain: {
              [key: string]: number;
            };
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  markRetentionRequired: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": {
          /** Format: uuid */
          userId: string;
          reason: string;
        };
      };
    };
    responses: {
      /** @description Retention requirement recorded with an audit reason */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  sendOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["SendOtpInput"];
      };
    };
    responses: {
      /** @description OTP challenge dispatched */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["SendOtpResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  verifyOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["VerifyOtpInput"];
      };
    };
    responses: {
      /** @description Authenticated session created */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Session cookie for browser clients */
          "set-cookie"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["VerifyOtpResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  rotateSession: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session token rotated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Session cookie for browser clients */
          "set-cookie"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["RotateSessionResponse"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getSessions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of active user sessions */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ListSessionsResponse"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  lockTrustedDevice: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Trusted device locked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "locked";
          };
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  logout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Session cookie for browser clients */
          "set-cookie"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "logged_out";
          };
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  logoutAll: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description All sessions revoked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Session cookie for browser clients */
          "set-cookie"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "logged_out_all";
          };
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  revokeSession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Session UUID to revoke */
        sessionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Session cookie for browser clients */
          "set-cookie"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "revoked";
          };
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createFund: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateFund"];
      };
    };
    responses: {
      /** @description Fake fund created */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Fund"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getFund: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Fake fund */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Fund"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  changeFundVisibility: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {string} */
          visibility: "public" | "donors" | "members" | "private";
          expectedVersion: number;
        };
      };
    };
    responses: {
      /** @description Fund visibility updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Fund"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicFundSummary: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical FundId UUID; inaccessible funds return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Visibility-filtered fund summary */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Representation validator for public-tier responses */
          etag?: string;
          /** @description Public short shared cache; authenticated tiers are private and no-store */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            fundId: string;
            name: string;
            purpose: string | null;
            /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
            raisedPaise: string | null;
            /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
            spentPaise: string;
            /** @enum {string} */
            verification: "bank-matched" | "anchored" | "unverified";
            dataGaps: string[];
          };
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicFundBreakdown: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical FundId UUID; inaccessible funds return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Visibility-filtered spend breakdown */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Representation validator for public-tier responses */
          etag?: string;
          /** @description Public short shared cache; authenticated tiers are private and no-store */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            fundId: string;
            categories: {
              category: string;
              /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
              spentPaise: string;
              transactionCount: number;
            }[];
            dataGaps: string[];
          };
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicFundTimeline: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical FundId UUID; inaccessible funds return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Visibility-filtered plain language timeline */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Representation validator for public-tier responses */
          etag?: string;
          /** @description Public short shared cache; authenticated tiers are private and no-store */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            fundId: string;
            items: {
              /** Format: uuid */
              id: string;
              /** Format: date-time */
              occurredAt: string;
              message: string;
              actorDisplayName?: string;
              /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
              amountPaise?: string;
              /** @enum {string} */
              alertType?:
                | "unapproved_debit"
                | "balance_drift"
                | "chain_verification_failure"
                | "anchor_missing"
                | "anchor_mismatch"
                | "repeated_rejected_requests"
                | "spend_rate_spike"
                | "integrity_check_failure";
              /** @enum {string} */
              severity?: "info" | "warning" | "critical";
              title?: string;
              /** @enum {string} */
              verified: "bank-matched" | "anchored" | "unverified";
            }[];
            dataGaps: string[];
          };
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicAuditBundle: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical FundId UUID; inaccessible funds return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Canonical audit bundle v1 for fund interval */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Representation validator for public-tier responses */
          etag?: string;
          /** @description Public short shared cache; authenticated tiers are private and no-store */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            format: "yen/audit-bundle/v1";
            /** Format: uuid */
            fund_id: string;
            chain: {
              start_seq: number;
              start_hash: string;
            };
            events: {
              [key: string]: unknown;
            }[];
            roots: {
              [key: string]: unknown;
            }[];
            anchor: {
              chain_id: number;
              contract_address: string;
              tx_hash: string;
              root: string;
              sequence: number;
            };
          };
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicRecordProof: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical FundId UUID */
        fundId: string;
        /** @description Record, expense, or donation identifier */
        recordId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Record cryptographic proof and anchor status */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Representation validator for public-tier responses */
          etag?: string;
          /** @description Public short shared cache; authenticated tiers are private and no-store */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            recordId: string;
            /** Format: uuid */
            fundId: string;
            /** @enum {string} */
            status: "anchored" | "pending";
            event: {
              [key: string]: unknown;
            };
            salt?: string;
            latestEventHash?: string;
            eventProof?: {
              index: number;
              size: number;
              path: string[];
            };
            fundProof?: {
              index: number;
              size: number;
              path: string[];
            };
            anchor?: {
              chainId: number;
              contractAddress: string;
              txHash: string;
              root: string;
              sequence: number;
            };
            pendingWindow?: {
              message: string;
              estimatedAnchorMinutes: number;
            };
          };
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicExpenseDetail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tier-filtered expense details */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Representation validator */
          etag?: string;
          /** @description Visibility-tier cache policy */
          "cache-control"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PublicExpenseDetail"];
        };
      };
      /** @description Invalid fund or expense identifier */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Unknown or inaccessible fund or expense */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Dependency unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getPublicExpenseProofs: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tier-filtered proof metadata and allowed files */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Representation validator */
          etag?: string;
          /** @description Visibility-tier cache policy */
          "cache-control"?: string;
          /** @description Forces evidence response to download as an attachment */
          "content-disposition"?: string;
          /** @description Disables MIME sniffing */
          "x-content-type-options"?: "nosniff";
          /** @description Sandboxes the evidence response */
          "content-security-policy"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PublicExpenseProofs"];
        };
      };
      /** @description Invalid fund or expense identifier */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Unknown or inaccessible fund or expense */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Dependency unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  listExpenses: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of expenses */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"][];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        /** @description Canonical lowercase FundId UUID */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateExpenseInput"];
      };
    };
    responses: {
      /** @description Draft expense created */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getExpense: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Expense details */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  submitExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Expense submitted and funds reserved via hold */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  approveExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["ExpenseApprovalInput"];
      };
    };
    responses: {
      /** @description Expense approved */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ExpenseApprovalResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  rejectExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["ExpenseRejectionInput"];
      };
    };
    responses: {
      /** @description Expense rejected */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ExpenseRejectionResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  payExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PayExpenseInput"];
      };
    };
    responses: {
      /** @description Expense paid and hold settled */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  reconcileExpense: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ReconcileExpenseInput"];
      };
    };
    responses: {
      /** @description Expense reconciled */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Expense"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  listFundAlerts: {
    parameters: {
      query?: {
        /** @description Page size, 1 to 100 */
        limit?: number;
        /** @description Exclusive created_at cursor: return alerts older than this */
        before?: string;
      };
      header?: never;
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Fund alerts, newest first */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["FundAlert"][];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  acknowledgeAlert: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        alertId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AlertNoteInput"];
      };
    };
    responses: {
      /** @description Alert acknowledged */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["FundAlert"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  resolveAlert: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        alertId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AlertNoteInput"];
      };
    };
    responses: {
      /** @description Alert resolved */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["FundAlert"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getDonationDetails: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Where to send a donation */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DonationDetails"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  pledgeDonation: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DonationPledge"];
      };
    };
    responses: {
      /** @description Pledge recorded */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DonationPledgeResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Reference already claimed, or idempotency conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Request body too large */
      413: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getReceipt: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Donation pledge UUID or 12-digit UTR reference */
        receiptId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Donor donation receipt details */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DonorReceipt"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getReceiptPdf: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Donation pledge UUID or 12-digit UTR reference */
        receiptId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Binary PDF receipt file */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          "content-type"?: string;
          "content-disposition"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/pdf": string;
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getReceiptSvg: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Donation pledge UUID or 12-digit UTR reference */
        receiptId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Vector SVG receipt image */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          "content-type"?: string;
          "content-disposition"?: string;
          [name: string]: unknown;
        };
        content: {
          "image/svg+xml": string;
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createSubscription: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateFundSubscriptionInput"];
      };
    };
    responses: {
      /** @description Subscription created or updated */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["FundSubscription"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  unsubscribeGet: {
    parameters: {
      query: {
        token: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Valid unsubscribe token; confirmation required */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["UnsubscribeStatusResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  unsubscribe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UnsubscribeInput"];
      };
    };
    responses: {
      /** @description Successfully unsubscribed */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["UnsubscribeResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  changeExpensePayee: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "x-approval-pin"?: string;
        "x-approval-token"?: string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          identity:
            | {
                /** @enum {string} */
                kind: "upi";
                vpa: string;
              }
            | {
                /** @enum {string} */
                kind: "bank";
                account: string;
                ifsc: string;
              };
          name: string;
          gstin?: string;
        };
      };
    };
    responses: {
      /** @description Expense payee updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            payee: {
              identity:
                | {
                    /** @enum {string} */
                    kind: "upi";
                    vpa: string;
                  }
                | {
                    /** @enum {string} */
                    kind: "bank";
                    account: string;
                    ifsc: string;
                  };
              name: string;
              gstin?: string;
              verification: {
                /** @enum {string} */
                status: "unverified" | "verified" | "failed";
                provider?: string;
                reference?: string;
                /** Format: date-time */
                verifiedAt?: string;
              };
            };
            fraudFlags: {
              /** @enum {string} */
              code:
                | "new_payee_large_first_payment"
                | "payee_changed_cooling_off"
                | "self_payment"
                | "split_requests"
                | "duplicate_invoice"
                | "duplicate_evidence"
                | "gstin_name_mismatch"
                | "payee_velocity";
              reason: string;
            }[];
          };
        };
      };
      /** @description Validation failed */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  acknowledgeExpenseFraudFlag: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "x-approval-pin"?: string;
        "x-approval-token"?: string;
      };
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {string} */
          code:
            | "new_payee_large_first_payment"
            | "payee_changed_cooling_off"
            | "self_payment"
            | "split_requests"
            | "duplicate_invoice"
            | "duplicate_evidence"
            | "gstin_name_mismatch"
            | "payee_velocity";
          reason: string;
        };
      };
    };
    responses: {
      /** @description Acknowledgement recorded */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            acknowledgements: {
              /** @enum {string} */
              code:
                | "new_payee_large_first_payment"
                | "payee_changed_cooling_off"
                | "self_payment"
                | "split_requests"
                | "duplicate_invoice"
                | "duplicate_evidence"
                | "gstin_name_mismatch"
                | "payee_velocity";
              actorPseudonym: string;
              reason: string;
              /** Format: date-time */
              acknowledgedAt: string;
            }[];
          };
        };
      };
      /** @description Validation failed */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  setMemberPayeeProfile: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        pseudonymId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          identity:
            | {
                /** @enum {string} */
                kind: "upi";
                vpa: string;
              }
            | {
                /** @enum {string} */
                kind: "bank";
                account: string;
                ifsc: string;
              };
          name: string;
          gstin?: string;
        };
      };
    };
    responses: {
      /** @description Fingerprint stored */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "set";
          };
        };
      };
      /** @description Validation failed */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  clearMemberPayeeProfile: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        pseudonymId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Fingerprint removed */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "cleared";
          };
        };
      };
      /** @description Validation failed */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  updatePayeeRulesPolicy: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
          newPayeeFirstPaymentPaise: string;
          /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
          largeExpensePaise: string;
          coolingOffHours: number;
          splitWindowHours: number;
          /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
          approvalThresholdPaise: string;
          velocityWindowHours: number;
          /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
          velocityMaxPaise: string;
          blockedFlagCodes: (
            | "new_payee_large_first_payment"
            | "payee_changed_cooling_off"
            | "self_payment"
            | "split_requests"
            | "duplicate_invoice"
            | "duplicate_evidence"
            | "gstin_name_mismatch"
            | "payee_velocity"
          )[];
        };
      };
    };
    responses: {
      /** @description Policy updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "updated";
          };
        };
      };
      /** @description Validation failed */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  listOwnerInvites: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Owner invites awaiting confirmation */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            invites: {
              /** Format: uuid */
              inviteId: string;
              displayName: string | null;
              phoneEnding: string;
              /** @enum {string} */
              status: "issued" | "redeemed";
            }[];
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createOwnerInvite: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          phone: string;
        };
      };
    };
    responses: {
      /** @description Single-use invite code; show as QR or pass in person */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            inviteId: string;
            code: string;
            /** Format: date-time */
            expiresAt: string;
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  confirmOwnerInvite: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        fundId: string;
        inviteId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Owner confirmed the in-person member */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "confirmed";
            displayName: string;
            phoneEnding: string;
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  redeemOwnerInvite: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          code: string;
          phone: string;
          displayName: string;
        };
      };
    };
    responses: {
      /** @description Redeemed invite or completed sign-in */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json":
            | {
                /** @enum {string} */
                status: "pending_owner_confirmation";
              }
            | {
                /** @enum {string} */
                status: "authenticated";
                session: {
                  /** Format: uuid */
                  id: string;
                  token: string;
                  /** Format: date-time */
                  expiresAt: string;
                  user: {
                    /** Format: uuid */
                    id: string;
                    phone: string;
                    displayName: string;
                    locale: string;
                  };
                };
              };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  setupApprovalPin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PinSetupInput"];
      };
    };
    responses: {
      /** @description Approval PIN configured */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PinSetupResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  unlockTrustedDevice: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UnlockTrustedDeviceInput"];
      };
    };
    responses: {
      /** @description Trusted device unlocked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["UnlockTrustedDeviceResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getApprovalPinStatus: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current approval PIN status */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PinStatus"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  verifyApprovalPin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["VerifyPinInput"];
      };
    };
    responses: {
      /** @description PIN verified and approval token issued */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["VerifyPinResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  changeApprovalPin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ChangePinInput"];
      };
    };
    responses: {
      /** @description Approval PIN updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ChangePinResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  requestPinReset: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ResetPinRequestInput"];
      };
    };
    responses: {
      /** @description OTP challenge initiated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ResetPinRequestResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  confirmPinReset: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ResetPinConfirmInput"];
      };
    };
    responses: {
      /** @description PIN reset into 24-hour cooling-off period */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ResetPinConfirmResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  unlockApprovalPin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UnlockPinInput"];
      };
    };
    responses: {
      /** @description Approver PIN unlocked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["UnlockPinResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  changeFundPayee: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PayeeChangeInput"];
      };
    };
    responses: {
      /** @description Payee updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PayeeChangeResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  changeFundPolicy: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PolicyChangeInput"];
      };
    };
    responses: {
      /** @description Policy updated */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PolicyChangeResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  addFundMember: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AddMemberInput"];
      };
    };
    responses: {
      /** @description Member added */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["AddMemberResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  removeFundMember: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
        "X-Approval-Token"?: string;
        /** @description 6-digit Yen approval PIN */
        "X-Approval-Pin"?: string;
      };
      path: {
        fundId: string;
        memberId: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["RemoveMemberInput"];
      };
    };
    responses: {
      /** @description Member removed */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["RemoveMemberResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getEvidence: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
        /** @description Canonical lowercase ExpenseId UUID; invalid IDs return 404 */
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Evidence list */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            evidence: {
              /**
               * Format: uuid
               * @description Unique identifier for this evidence upload
               */
              evidenceId: string;
              /** Format: uuid */
              fundId: string;
              /** Format: uuid */
              expenseId: string;
              /** @description SHA-256 hash computed by the server from the uploaded bytes */
              fileSha256: string;
              /**
               * @description MIME type of uploaded file
               * @enum {string}
               */
              mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
              fileSizeBytes: number;
              fileName: string;
              /** @description Identical bytes were attached to another expense in this fund */
              duplicateDetected: boolean;
              /** @description Alias for duplicateDetected */
              isDuplicate: boolean;
              /**
               * Format: uuid
               * @description Expense ID of the prior duplicate in this fund, when present
               */
              duplicateExpenseId?: string;
              vendorName?: string;
              gstin?: string;
              invoiceNumber?: string;
              invoiceDate?: string;
              scan: {
                scannerName: string;
                signatureVersion: string;
                /** @enum {string} */
                result: "clean";
              };
              /** Format: date-time */
              createdAt: string;
            }[];
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  uploadEvidence: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
        /** @description Canonical lowercase ExpenseId UUID; invalid IDs return 404 */
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "multipart/form-data": components["schemas"]["UploadEvidenceInput"];
      };
    };
    responses: {
      /** @description Evidence stored with a server-computed hash */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /**
             * Format: uuid
             * @description Unique identifier for this evidence upload
             */
            evidenceId: string;
            /** Format: uuid */
            fundId: string;
            /** Format: uuid */
            expenseId: string;
            /** @description SHA-256 hash computed by the server from the uploaded bytes */
            fileSha256: string;
            /**
             * @description MIME type of uploaded file
             * @enum {string}
             */
            mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
            fileSizeBytes: number;
            fileName: string;
            /** @description Identical bytes were attached to another expense in this fund */
            duplicateDetected: boolean;
            /** @description Alias for duplicateDetected */
            isDuplicate: boolean;
            /**
             * Format: uuid
             * @description Expense ID of the prior duplicate in this fund, when present
             */
            duplicateExpenseId?: string;
            vendorName?: string;
            gstin?: string;
            invoiceNumber?: string;
            invoiceDate?: string;
            scan: {
              scannerName: string;
              signatureVersion: string;
              /** @enum {string} */
              result: "clean";
            };
            /** Format: date-time */
            createdAt: string;
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Evidence body exceeds the upload size limit of 10MB */
      413: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  uploadStatement: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["StatementUploadInput"];
      };
    };
    responses: {
      /** @description Statement parsed and ingested */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["StatementUploadResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  partnerWebhook: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PartnerWebhookInput"];
      };
    };
    responses: {
      /** @description Webhook processed */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PartnerWebhookResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getUnmatchedCredits: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Queue of unmatched credits */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["UnmatchedCreditsResponse"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  manualMatch: {
    parameters: {
      query?: never;
      header: {
        "Idempotency-Key": string;
      };
      path: {
        /** @description Canonical lowercase FundId UUID; invalid IDs return 404 */
        fundId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ManualMatchInput"];
      };
    };
    responses: {
      /** @description Manual match successful */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ManualMatchResult"];
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Transaction or pledge already matched */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  listExpenseObjections: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Objection counts and tier redacted records */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            count: number;
            openCount: number;
            objections?: {
              /** Format: uuid */
              id: string;
              createdAt: string;
              /** @enum {string|null} */
              resolution: "upheld" | "dismissed" | null;
              reason?: string;
            }[];
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  raiseExpenseObjection: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Objection recorded */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "raised";
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  resolveExpenseObjection: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fundId: string;
        expenseId: string;
        objectionId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
          /** @enum {string} */
          resolution: "upheld" | "dismissed";
        };
      };
    };
    responses: {
      /** @description Objection resolved */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "rejected" | "submitted" | "approved";
            /** Format: uuid */
            expenseId: string;
          };
        };
      };
      /** @description Validation failed; details contain field paths */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict, changed idempotency input, or request in progress */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Present on replay */
          "idempotent-replayed"?: "true";
          /** @description Seconds until retry */
          "retry-after"?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createDeviceCredentialRegistrationOptions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Registration options */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            challenge: string;
            rp: {
              id?: string;
              name: string;
            };
            user: {
              id: string;
              name: string;
              displayName: string;
            };
            pubKeyCredParams: {
              /** @enum {string} */
              type: "public-key";
              alg: number;
            }[];
            timeout?: number;
            excludeCredentials?: {
              id: string;
              /** @enum {string} */
              type: "public-key";
              transports?: string[];
            }[];
            authenticatorSelection?: {
              /** @enum {string} */
              authenticatorAttachment?: "platform" | "cross-platform";
              /** @enum {string} */
              residentKey?: "discouraged" | "preferred" | "required";
              requireResidentKey?: boolean;
              /** @enum {string} */
              userVerification?: "required" | "preferred" | "discouraged";
            };
            /** @enum {string} */
            attestation?: "none" | "indirect" | "direct" | "enterprise";
            extensions?: {
              [key: string]: unknown;
            };
          } & {
            [key: string]: unknown;
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  registerDeviceCredential: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          label: string;
          pin: string;
          response: {
            [key: string]: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Credential registered */
      201: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            credentialId: string;
            label: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastUsedAt: string | null;
            /** Format: date-time */
            revokedAt: string | null;
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  listDeviceCredentials: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Device credentials */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            credentials: {
              credentialId: string;
              label: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              lastUsedAt: string | null;
              /** Format: date-time */
              revokedAt: string | null;
            }[];
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  revokeDeviceCredential: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        credentialId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Credential revoked */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "revoked";
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  createDeviceSignatureOptions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          actionHash: string;
        };
      };
    };
    responses: {
      /** @description Assertion options */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            challenge: string;
            rpId?: string;
            timeout?: number;
            allowCredentials?: {
              id: string;
              /** @enum {string} */
              type: "public-key";
              transports?: string[];
            }[];
            /** @enum {string} */
            userVerification?: "required" | "preferred" | "discouraged";
            extensions?: {
              [key: string]: unknown;
            };
          } & {
            [key: string]: unknown;
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  verifyDeviceSignature: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          actionHash: string;
          response: {
            [key: string]: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Device signature proof */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            deviceProof: string;
            /** Format: date-time */
            expiresAt: string;
          };
        };
      };
      /** @description Invalid request */
      400: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Authentication required */
      401: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Access denied */
      403: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource not found */
      404: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Resource conflict */
      409: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Service unavailable */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  getOpenApi: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OpenAPI 3.1 contract */
      200: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            [key: string]: unknown;
          };
        };
      };
      /** @description Rate limit exceeded */
      429: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Internal failure; no private error information */
      500: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Rate limit store at capacity */
      503: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          /** @description Seconds until retry */
          "retry-after": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
      /** @description Gateway timeout */
      504: {
        headers: {
          /** @description Request correlation ID */
          "x-request-id": string;
          /** @description OpenTelemetry trace ID, or request correlation ID when tracing is disabled */
          "x-trace-id": string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorEnvelope"];
        };
      };
    };
  };
  verifyMetaDeliveryWebhook: {
    parameters: {
      query: {
        "hub.mode": "subscribe";
        "hub.verify_token": string;
        "hub.challenge": string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Webhook verification challenge */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/plain": string;
        };
      };
      /** @description Webhook verification rejected */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  receiveMetaDeliveryStatusWebhook: {
    parameters: {
      query?: never;
      header: {
        "X-Hub-Signature-256": string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Webhook accepted */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/plain": string;
        };
      };
      /** @description Malformed webhook */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Webhook signature rejected */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  receiveExotelRelayDeliveryStatusWebhook: {
    parameters: {
      query?: never;
      header: {
        "X-Hub-Signature-256": string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/x-www-form-urlencoded": {
          SmsSid: string;
          Status: string;
        };
      };
    };
    responses: {
      /** @description Webhook accepted */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/plain": string;
        };
      };
      /** @description Malformed callback */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Webhook signature rejected */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
}
