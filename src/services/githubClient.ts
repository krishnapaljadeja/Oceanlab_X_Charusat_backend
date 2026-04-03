import axios, { AxiosInstance, AxiosResponse } from "axios";
import { RateLimitStatus } from "../types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_URL = "https://api.github.com";

export const githubAxios: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: GITHUB_TOKEN ? `Bearer ${GITHUB_TOKEN}` : "",
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
  timeout: 15000,
});

// Response interceptor: log rate limit headers
githubAxios.interceptors.response.use(
  (response) => {
    const remaining = response.headers["x-ratelimit-remaining"];
    if (remaining !== undefined && parseInt(remaining) < 100) {
      console.warn(`[GitHub] Rate limit low: ${remaining} requests remaining`);
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 403) {
      const retryAfter = error.response.headers["retry-after"];
      if (retryAfter) {
        console.warn(`[GitHub] Rate limited. Retry after ${retryAfter}s`);
        throw new Error("RATE_LIMITED");
      }
    }
    if (error.response?.status === 404) {
      throw new Error("REPO_NOT_FOUND");
    }
    if (error.response?.status === 401) {
      throw new Error("BAD_TOKEN");
    }
    throw error;
  },
);

export async function getRateLimitStatus(): Promise<RateLimitStatus> {
  const response: AxiosResponse = await githubAxios.get("/rate_limit");
  const core = response.data.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000).toISOString(),
    isLow: core.remaining < 200,
  };
}

// Generic paginator — fetches all pages of a GitHub list endpoint
export async function paginateAll<T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  maxItems: number = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  const perPage = 100;

  while (results.length < maxItems) {
    const response: AxiosResponse<T[]> = await githubAxios.get(endpoint, {
      params: { ...params, per_page: perPage, page },
    });

    const items = response.data;
    if (!items || items.length === 0) break;

    results.push(...items);
    if (items.length < perPage) break;
    page++;
  }

  return results.slice(0, maxItems);
}
