export const DEFAULT_WEB_PORT = "3000";
export const DEFAULT_API_PORT = "3001";
export const DEFAULT_API_URL = "http://localhost:3001";
export const DEFAULT_OBJECTION_WINDOW_SECONDS = "5";

// Strip the ambient PORT so Next.js and Hono cannot both bind the same value.
// Each app pins its own port via WEB_PORT / API_PORT instead.
export function buildDevServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { PORT: _ambientPort, ...rest } = env;
  return {
    ...rest,
    NODE_ENV: "development",
    OBJECTION_WINDOW_SECONDS: rest.OBJECTION_WINDOW_SECONDS || DEFAULT_OBJECTION_WINDOW_SECONDS,
    WEB_PORT: rest.WEB_PORT || DEFAULT_WEB_PORT,
    API_PORT: rest.API_PORT || DEFAULT_API_PORT,
    NEXT_PUBLIC_API_URL:
      rest.NEXT_PUBLIC_API_URL || `http://localhost:${rest.API_PORT || DEFAULT_API_PORT}`,
  };
}
