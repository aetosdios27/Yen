export const CACHE_VERSION: string;
export const CACHE_NAME: string;
export const OFFLINE_URL: string;
export const PRECACHE_URLS: string[];

export function isNavigationRequest(request?: unknown): boolean;
export function shouldCache(request?: unknown, response?: unknown, baseOrigin?: string): boolean;
export function cleanOldCaches(
  cacheStorage?: unknown,
  currentCacheName?: string,
): Promise<string[]>;
