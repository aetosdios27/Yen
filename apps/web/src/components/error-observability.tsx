"use client";

import { useEffect } from "react";
import { installClientObservability } from "../lib/observability";

/** Installs window level error and unhandled rejection capture once per page. */
export function ErrorObservability() {
  useEffect(() => installClientObservability(), []);
  return null;
}
