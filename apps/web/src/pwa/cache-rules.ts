export interface RequestLike {
  url: string;
  method?: string | undefined;
  mode?: string | undefined;
  destination?: string | undefined;
  headers?:
    | {
        get(name: string): string | null;
      }
    | Record<string, string>
    | undefined;
}

export interface ResponseLike {
  status?: number | undefined;
  ok?: boolean | undefined;
  type?: string | undefined;
  headers?:
    | {
        get(name: string): string | null;
      }
    | Record<string, string>
    | undefined;
}

export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(key: string): Promise<boolean>;
}

import "../../public/sw-rules.js";

interface SwRules {
  CACHE_VERSION: string;
  CACHE_NAME: string;
  OFFLINE_URL: string;
  PRECACHE_URLS: string[];
  isNavigationRequest(request?: RequestLike): boolean;
  shouldCache(request?: RequestLike, response?: ResponseLike, baseOrigin?: string): boolean;
  cleanOldCaches(cacheStorage?: CacheStorageLike, currentCacheName?: string): Promise<string[]>;
}

// sw-rules.js is a classic script that publishes its rules on this global (see that file).
const rules = (globalThis as unknown as { YenSwRules: SwRules }).YenSwRules;

export const {
  CACHE_NAME,
  CACHE_VERSION,
  cleanOldCaches,
  isNavigationRequest,
  OFFLINE_URL,
  PRECACHE_URLS,
  shouldCache,
} = rules;
