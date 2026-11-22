import type { Env } from "./env";

/** One call to the LocalAds public API. Throws with the API's own message. */
export async function localads<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const response = await fetch(`${env.LOCALADS_API_URL}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      authorization: `Bearer ${env.LOCALADS_API_KEY}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  const json = text ? safeJson(text) : null;
  if (!response.ok) {
    const detail = (json as { detail?: string; title?: string } | null)?.detail;
    throw new Error(`LocalAds ${response.status} on ${path}: ${detail ?? text.slice(0, 200)}`);
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface Brand {
  id: string;
  name: string;
  website_url: string | null;
  product_count?: number;
}

export interface Product {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  source_url: string | null;
  image_urls: string[];
  status: "draft" | "processing" | "ready" | "failed";
}

export interface Campaign {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  credits_charged: number;
  requested_creative_count: number;
  completed_creative_count: number;
  failed_creative_count: number;
  creatives: { id: string; status: string; image_url: string | null }[];
}

export interface Video {
  id: string;
  status: string;
  title: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  credits_charged?: number;
}

/** Every brand in the workspace (the list is paged, 100 at a time). */
export async function listBrands(env: Env): Promise<Brand[]> {
  const brands: Brand[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const result: { data: Brand[]; next_cursor: string | null } = await localads(
      env,
      `/brands?limit=100${query}`,
    );
    brands.push(...result.data);
    cursor = result.next_cursor;
    if (!cursor) break;
  }
  return brands;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
