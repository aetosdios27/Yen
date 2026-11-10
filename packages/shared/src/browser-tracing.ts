function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function browserApiFetch(
  input: Request,
  send: typeof fetch = fetch,
): Promise<Response> {
  const request = new Request(input);
  request.headers.set("x-request-id", crypto.randomUUID());
  request.headers.set("traceparent", `00-${randomHex(16)}-${randomHex(8)}-01`);
  return send(request);
}
