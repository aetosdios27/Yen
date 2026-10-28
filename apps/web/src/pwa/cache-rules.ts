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

export {
  CACHE_NAME,
  CACHE_VERSION,
  cleanOldCaches,
  isNavigationRequest,
  OFFLINE_URL,
  PRECACHE_URLS,
  shouldCache,
} from "../../public/sw-rules.js";
