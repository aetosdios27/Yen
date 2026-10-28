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
          | "rate_limited"
          | "overloaded"
          | "payload_too_large"
          | "internal";
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
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      targetPaise: string;
      /** Format: uuid */
      id: string;
      /** Format: date-time */
      createdAt: string;
    };
    CreateFund: {
      name: string;
      /** @description Nonnegative integer paise as a canonical decimal string; never a JSON number. */
      targetPaise: string;
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
    };
  };
}
