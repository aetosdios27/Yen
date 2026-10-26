import type { ChainHead, ChainStructureCheck } from "./index.js";

type ObservedHead = Extract<ChainStructureCheck, { ok: true }>["observedHead"];
type RequiresChainHead<T extends ChainHead> = T;

// @ts-expect-error An observed head has no authenticated provenance.
type RejectObservedHead = RequiresChainHead<ObservedHead>;
