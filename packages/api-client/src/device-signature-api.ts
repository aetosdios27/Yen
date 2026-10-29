import type { createYenClient } from "./index.js";

type YenClient = ReturnType<typeof createYenClient>;

export function createDeviceSignatureApi(client: YenClient) {
  return {
    registrationOptions: () => client.POST("/v1/auth/device-credentials/registration/options", {}),
    registerCredential: (body: {
      readonly label: string;
      readonly pin: string;
      readonly response: Record<string, unknown>;
    }) => client.POST("/v1/auth/device-credentials/registration/verify", { body }),
    listCredentials: () => client.GET("/v1/auth/device-credentials"),
    revokeCredential: (credentialId: string) =>
      client.DELETE("/v1/auth/device-credentials/{credentialId}", {
        params: { path: { credentialId } },
      }),
    assertionOptions: (body: { readonly actionHash: string }) =>
      client.POST("/v1/auth/device-signatures/options", { body }),
    verifyAssertion: (body: {
      readonly actionHash: string;
      readonly response: Record<string, unknown>;
    }) => client.POST("/v1/auth/device-signatures/verify", { body }),
  };
}
