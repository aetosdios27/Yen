export type FaultTracker = {
  /** Installs the process listeners; returns the matching cleanup. */
  install: () => () => void;
  current: () => string | null;
  clear: () => void;
};

/**
 * A rejected promise nobody awaited means some work was silently lost. The
 * process keeps serving, so readiness is the place that has to admit it.
 */
export function createFaultTracker(): FaultTracker {
  let fault: string | null = null;
  const record = () => {
    fault ??= "unhandled_rejection";
  };

  return {
    install: () => {
      process.on("unhandledRejection", record);
      return () => {
        process.off("unhandledRejection", record);
      };
    },
    current: () => fault,
    clear: () => {
      fault = null;
    },
  };
}
