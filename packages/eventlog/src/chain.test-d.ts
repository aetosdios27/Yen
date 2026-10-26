import type { ChainHead, ChainStructureCheck, chainHead } from "./index.js";

type ObservedHead = Extract<
  ChainStructureCheck,
  { status: "structure-consistent" }
>["observedHead"];
type AssertFalse<T extends false> = T;
export type ObservedHeadIsNotAuthenticated = AssertFalse<
  ObservedHead extends ChainHead ? true : false
>;
export type ObservedHeadCannotBeValidatedDirectly = AssertFalse<
  ObservedHead extends Parameters<typeof chainHead>[0] ? true : false
>;
export type StructureHasNoOk = AssertFalse<"ok" extends keyof ChainStructureCheck ? true : false>;
export type ConstructorNeedsCanonicalFundId = AssertFalse<
  string extends Parameters<typeof chainHead>[0]["fundId"] ? true : false
>;
