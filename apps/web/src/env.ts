import * as z from "zod";

const schema = z.object({
  NEXT_PUBLIC_API_URL: z
    .url({ protocol: /^https?$/, error: "must be an absolute HTTP(S) URL" })
    .transform((url) => url.replace(/\/+$/, "")),
});

const parsed = schema.safeParse({ NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL });
if (!parsed.success) {
  throw new Error(
    `Invalid web environment:\n${parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;
