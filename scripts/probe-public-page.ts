import { startObservability } from "@yen/shared/observability";
import { probePublicPage } from "@yen/shared/telemetry";
import { z } from "zod";

const config = z
  .object({
    PUBLIC_PAGE_PROBE_URL: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  })
  .parse(process.env);
const sdk = startObservability(config.OTEL_EXPORTER_OTLP_ENDPOINT);
try {
  if (!(await probePublicPage(new URL(config.PUBLIC_PAGE_PROBE_URL)))) process.exitCode = 1;
} finally {
  await sdk?.shutdown();
}
