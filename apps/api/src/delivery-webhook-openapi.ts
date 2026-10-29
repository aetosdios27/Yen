export const deliveryWebhookOpenApiPaths = {
  "/v1/delivery/webhooks/meta": {
    get: {
      operationId: "verifyMetaDeliveryWebhook",
      summary: "Verify the Meta delivery webhook endpoint",
      parameters: [
        {
          name: "hub.mode",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["subscribe"] },
        },
        { name: "hub.verify_token", in: "query", required: true, schema: { type: "string" } },
        { name: "hub.challenge", in: "query", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Webhook verification challenge",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        "403": { description: "Webhook verification rejected" },
      },
    },
    post: {
      operationId: "receiveMetaDeliveryStatusWebhook",
      summary: "Receive Meta WhatsApp delivery status events",
      parameters: [
        {
          name: "X-Hub-Signature-256",
          in: "header",
          required: true,
          schema: { type: "string", pattern: "^sha256=[a-f0-9]{64}$" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
      },
      responses: {
        "200": {
          description: "Webhook accepted",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        "400": { description: "Malformed webhook" },
        "401": { description: "Webhook signature rejected" },
      },
    },
  },
  "/v1/delivery/webhooks/exotel": {
    post: {
      operationId: "receiveExotelRelayDeliveryStatusWebhook",
      summary: "Receive an HMAC-signed Exotel SMS callback from the configured relay",
      parameters: [
        {
          name: "X-Hub-Signature-256",
          in: "header",
          required: true,
          schema: { type: "string", pattern: "^sha256=[a-f0-9]{64}$" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["SmsSid", "Status"],
              properties: { SmsSid: { type: "string" }, Status: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Webhook accepted",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        "400": { description: "Malformed callback" },
        "401": { description: "Webhook signature rejected" },
      },
    },
  },
} as const;
