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
  "/v1/auth/otp/send": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Send a 6-digit OTP to a phone number via WhatsApp or SMS fallback. */
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
     * @description Idempotent webhook receiver for payment partner notifications (e.g. UPI virtual account credit).
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
      description: string;
      recipientRef: string;
      status: components["schemas"]["ExpenseStatus"];
      holdId: string | null;
      approvalsCount: number;
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
      description: string;
      recipientRef: string;
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
    };
    PayExpenseInput: {
      /** Format: uuid */
      bankTransactionId: string;
    };
    ReconcileExpenseInput: {
      /** Format: uuid */
      bankTransactionId: string;
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
      reconciliationStatus: "unmatched" | "matched" | "manually_matched" | "ignored";
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
      reconciliationStatus: "unmatched" | "matched" | "manually_matched" | "ignored";
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "ok";
          };
        };
      };
      /** @description Internal failure; no private error information */
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
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            status: "ok";
          };
        };
      };
      /** @description Internal failure; no private error information */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Reference already claimed, or idempotency conflict */
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
      /** @description Request body too large */
      413: {
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Evidence body exceeds the upload size limit of 10MB */
      413: {
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Resource conflict, changed idempotency input, or request in progress */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
      /** @description Transaction or pledge already matched */
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
      /** @description Internal failure; no private error information */
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
      /** @description Rate limit store at capacity */
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
}
