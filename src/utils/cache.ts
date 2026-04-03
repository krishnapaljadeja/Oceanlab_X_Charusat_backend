import NodeCache from "node-cache";

const TTL = parseInt(process.env.CACHE_TTL_SECONDS || "3600");

const cache = new NodeCache({ stdTTL: TTL, checkperiod: 120 });

export function getFromCache<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

export function setInCache<T>(key: string, value: T): void {
  cache.set(key, value);
}

export function getCacheStats() {
  return cache.getStats();
}

export function getCacheTTL(key: string): number {
  return cache.getTtl(key) || 0;
}
