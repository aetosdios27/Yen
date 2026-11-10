export type DependencyStatus = "ok" | "fail" | "skipped";

export type DependencyCheck = { readonly name: string; readonly status: DependencyStatus };

export type HealthReport = {
  readonly status: "ok" | "degraded";
  readonly checks: readonly DependencyCheck[];
};

export type HealthProbe = { readonly name: string; readonly run: () => Promise<boolean> };

/**
 * A probe that throws counts as failed: readiness must never report healthy
 * because a dependency check crashed instead of answering.
 */
export async function collectHealth(
  probes: readonly HealthProbe[],
  currentFault: () => string | null,
): Promise<HealthReport> {
  const checked = await Promise.all(
    probes.map(async (probe) => {
      const healthy = await probe.run().then(
        (value) => value,
        () => false,
      );
      return { name: probe.name, status: healthy ? ("ok" as const) : ("fail" as const) };
    }),
  );
  const fault = currentFault();
  const checks: DependencyCheck[] =
    fault === null ? checked : [...checked, { name: "runtime", status: "fail" }];
  return {
    status: checks.every((check) => check.status === "ok") ? "ok" : "degraded",
    checks,
  };
}
