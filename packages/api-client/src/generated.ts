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
    /** @description Uploads bill or receipt evidence. Computes SHA-256 server-side, validates GSTIN and MIME type, enforces the 10MB limit, and detects duplicates within the fund. */
    post: operations["uploadEvidence"];
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
