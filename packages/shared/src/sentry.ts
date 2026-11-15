/**
 * Minimal Sentry envelope encoding shared by the API and web reporters.
 * Pure string and header construction: transports stay injectable so tests
 * can capture dispatches without any network access.
 */

export type SentryDsn = {
  readonly envelopeUrl: string;
  readonly publicKey: string;
};

/**
 * Extracts the envelope endpoint and public key from a DSN of the form
 * https://<publicKey>@<host>/<projectId>. Null for anything else, so a
 * malformed DSN degrades to local logging instead of throwing.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  const match =
    /^(?<protocol>https?):\/\/(?<publicKey>[^@\s]+)@(?<host>[^/\s]+)\/(?<projectId>\d+)$/.exec(
      dsn.trim(),
    );
  const groups = match?.groups;
  if (!groups?.protocol || !groups.publicKey || !groups.host || !groups.projectId) return null;
  return {
    envelopeUrl: `${groups.protocol}://${groups.host}/api/${groups.projectId}/envelope/`,
    publicKey: groups.publicKey,
  };
}

export type SentryEvent = Record<string, unknown>;

export function sentryEnvelopeHeaders(
  publicKey: string,
  clientName: string,
): Record<string, string> {
  return {
    "content-type": "application/x-sentry-envelope",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_client=${clientName}, sentry_key=${publicKey}`,
  };
}

/** Serializes the three line envelope: header, item header, event payload. */
export function buildSentryEnvelope(
  eventId: string,
  event: SentryEvent,
  sentAt = new Date().toISOString(),
  sdkName = "yen.api",
  sdkVersion = "1.0.0",
): string {
  const header = {
    event_id: eventId,
    sent_at: sentAt,
    sdk: { name: sdkName, version: sdkVersion },
  };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}
