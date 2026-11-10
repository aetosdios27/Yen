import { z } from "zod";

export const buildInfo = {
  gitSha: "__YEN_BUILD_SHA__",
  buildId: "__YEN_BUILD_ID__",
  artifactDigest: "__YEN_ARTIFACT_DIGEST__",
  releaseTag: "__YEN_RELEASE_TAG__",
  provenanceUrl: "__YEN_PROVENANCE_URL__",
} as const;

const runtimeDigest = z.union([z.literal(""), z.string().regex(/^sha256:[a-f0-9]{64}$/)]);

export function getBuildInfo() {
  return {
    ...buildInfo,
    artifactDigest: runtimeDigest.parse(
      process.env.YEN_ARTIFACT_DIGEST ??
        (buildInfo.artifactDigest.startsWith("__YEN_") ? "" : buildInfo.artifactDigest),
    ),
  };
}
