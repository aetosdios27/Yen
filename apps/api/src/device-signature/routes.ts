import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import type { ApiEnv, AppDependencies } from "../dependencies.js";
import { ApiError } from "../errors.js";
import { logMethod } from "../logging.js";
import type {
  DeviceAssertionOptionsResponse,
  DeviceRegistrationOptionsResponse,
} from "./contract.js";
import {
  deviceAssertionOptionsRoute,
  deviceAssertionVerifyRoute,
  deviceCredentialListRoute,
  deviceCredentialRevokeRoute,
  deviceRegistrationOptionsRoute,
  deviceRegistrationVerifyRoute,
} from "./contract.js";
import { DeviceSignatureFailure } from "./service.js";

function principalId(c: Context<ApiEnv>): string {
  const principal = c.get("principal");
  if (!principal) throw new ApiError("unauthenticated");
  return principal.id;
}

function logFailure(
  c: Context<ApiEnv>,
  deps: AppDependencies,
  route: string,
  error: DeviceSignatureFailure,
) {
  deps.logger.log({
    event: "http_failure",
    requestId: c.get("requestId"),
    method: logMethod(c.req.method),
    route,
    errorKind: "validation",
    errorName: `DeviceSignatureFailure:${error.reason}`,
  });
}

function genericDeviceSignatureError(): ApiError {
  return new ApiError("validation_failed", [
    { path: ["json", "deviceProof"], message: "Device signature could not be verified" },
  ]);
}

export function registerDeviceSignatureRoutes(app: OpenAPIHono<ApiEnv>, deps: AppDependencies) {
  app.openapi(deviceRegistrationOptionsRoute, async (c) => {
    const userId = principalId(c);
    const options = (await deps.deviceSignatureService.registrationOptions(
      userId,
    )) as unknown as DeviceRegistrationOptionsResponse;
    return c.json(options, 200);
  });

  app.openapi(deviceRegistrationVerifyRoute, async (c) => {
    const userId = principalId(c);
    const input = c.req.valid("json");
    const action = { action: "device-credential:register", userId, label: input.label };
    await deps.pinService.verifyAction(userId, action, { pin: input.pin });
    try {
      const credential = await deps.deviceSignatureService.register(
        userId,
        input.label,
        input.response as unknown as RegistrationResponseJSON,
      );
      return c.json(credential, 201);
    } catch (error) {
      if (!(error instanceof DeviceSignatureFailure)) throw error;
      logFailure(c, deps, "/v1/auth/device-credentials/registration/verify", error);
      throw genericDeviceSignatureError();
    }
  });

  app.openapi(deviceCredentialListRoute, async (c) => {
    const credentials = [...(await deps.deviceSignatureService.listCredentials(principalId(c)))];
    return c.json({ credentials }, 200);
  });

  app.openapi(deviceCredentialRevokeRoute, async (c) => {
    const userId = principalId(c);
    const { credentialId } = c.req.valid("param");
    const revoked = await deps.deviceSignatureService.revokeCredential(userId, credentialId);
    if (!revoked) throw new ApiError("not_found");
    return c.json({ status: "revoked" as const }, 200);
  });

  app.openapi(deviceAssertionOptionsRoute, async (c) => {
    const userId = principalId(c);
    const { actionHash } = c.req.valid("json");
    try {
      const options = (await deps.deviceSignatureService.assertionOptions(
        userId,
        actionHash,
      )) as unknown as DeviceAssertionOptionsResponse;
      return c.json(options, 200);
    } catch (error) {
      if (!(error instanceof DeviceSignatureFailure)) throw error;
      logFailure(c, deps, "/v1/auth/device-signatures/options", error);
      throw new ApiError("forbidden", [
        { path: ["json", "actionHash"], message: "No active device credential is available" },
      ]);
    }
  });

  app.openapi(deviceAssertionVerifyRoute, async (c) => {
    const userId = principalId(c);
    const { actionHash, response } = c.req.valid("json");
    try {
      return c.json(
        await deps.deviceSignatureService.verifyAssertion(
          userId,
          actionHash,
          response as unknown as AuthenticationResponseJSON,
        ),
        200,
      );
    } catch (error) {
      if (!(error instanceof DeviceSignatureFailure)) throw error;
      await deps.pinService.recordFailedDeviceAssertion(userId);
      logFailure(c, deps, "/v1/auth/device-signatures/verify", error);
      throw genericDeviceSignatureError();
    }
  });
}
