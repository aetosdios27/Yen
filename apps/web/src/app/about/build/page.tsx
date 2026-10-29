"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n";

type VersionInfo = { gitSha: string; buildId: string; artifactDigest: string; releaseTag: string };
type State =
  | { kind: "loading" }
  | { kind: "unavailable" | "missing" }
  | { kind: "ready"; version: VersionInfo };

export default function BuildPage() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      setState({ kind: "unavailable" });
      return;
    }
    const controller = new AbortController();
    fetch(new URL("/version", apiUrl), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("API request failed");
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as VersionInfo).gitSha !== "string" ||
          !(body as VersionInfo).gitSha ||
          typeof (body as VersionInfo).buildId !== "string" ||
          !(body as VersionInfo).buildId
        ) {
          setState({ kind: "missing" });
          return;
        }
        setState({ kind: "ready", version: body as VersionInfo });
      })
      .catch(() => setState({ kind: "unavailable" }));
    return () => controller.abort();
  }, []);

  const version = state.kind === "ready" ? state.version : null;
  const commitUrl = version
    ? `https://github.com/aetosdios27/Yen/commit/${encodeURIComponent(version.gitSha)}`
    : "";
  const releaseTag = version?.releaseTag;
  const releaseUrl = releaseTag
    ? `https://github.com/aetosdios27/Yen/releases/tag/${encodeURIComponent(releaseTag)}`
    : null;

  return (
    <section aria-labelledby="build-page-title" className="mx-auto max-w-phone space-y-6 px-4 py-8">
      <h1 id="build-page-title" className="text-heading font-semibold text-ink">
        {t("buildPage.title")}
      </h1>
      <p className="text-body text-ink">{t("buildPage.intro")}</p>
      {state.kind === "loading" && <p role="status">{t("buildPage.loading")}</p>}
      {state.kind === "unavailable" && <p role="status">{t("buildPage.unavailable")}</p>}
      {state.kind === "missing" && <p role="status">{t("buildPage.missing")}</p>}
      {version && (
        <dl className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div>
            <dt className="font-semibold">{t("buildPage.commit")}</dt>
            <dd>
              <a href={commitUrl} className="break-all underline">
                {version.gitSha}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{t("buildPage.buildId")}</dt>
            <dd className="break-all">{version.buildId}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t("buildPage.digest")}</dt>
            <dd className="break-all">{version.artifactDigest || t("buildPage.noDigest")}</dd>
          </div>
        </dl>
      )}
      <ul className="space-y-3">
        {releaseUrl && (
          <li>
            <a className="underline" href={releaseUrl}>
              {t("buildPage.release")}
            </a>
          </li>
        )}
        {version?.releaseTag && (
          <li>
            <a
              className="underline"
              href={`https://github.com/aetosdios27/Yen/actions/attestations?query=${encodeURIComponent(`yen-${version.releaseTag}.tar`)}`}
            >
              {t("buildPage.attestation")}
            </a>
          </li>
        )}
        <li>
          <a
            className="underline"
            href="https://github.com/aetosdios27/Yen/blob/main/docs/verify-release.md"
          >
            {t("buildPage.guide")}
          </a>
        </li>
      </ul>
    </section>
  );
}
