export function useMemoryStore(config: {
  NODE_ENV: string;
  DATABASE_URL?: string | undefined;
  YEN_ALLOW_MEMORY_STORES?: string | undefined;
}): boolean {
  if (config.YEN_ALLOW_MEMORY_STORES === "true" && config.NODE_ENV === "production")
    throw new Error("YEN_ALLOW_MEMORY_STORES is forbidden in production");
  if (config.DATABASE_URL) return false;
  if (config.YEN_ALLOW_MEMORY_STORES === "true") return true;
  throw new Error("DATABASE_URL is required for the server");
}
