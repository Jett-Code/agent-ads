import type { Env } from "./env";

const ACTOR = "curious_coder~facebook-ads-library-scraper";

export interface CompetitorAd {
  id: string;
  page: string;
  format: string;
  daysRunning: number;
  variants: number;
  body: string;
  cta: string | null;
  imageUrl: string | null;
  libraryUrl: string | null;
}

interface RawAd {
  ad_archive_id?: string;
  page_name?: string;
  start_date?: number;
  collation_count?: number | null;
  ad_library_url?: string;
  snapshot?: {
    display_format?: string;
    body?: { text?: string | null } | null;
    cta_text?: string | null;
    images?: { original_image_url?: string; resized_image_url?: string }[];
    videos?: { video_preview_image_url?: string }[];
    cards?: { original_image_url?: string; resized_image_url?: string; video_preview_image_url?: string; body?: string }[];
  };
}

/** Repeat searches in one worker instance are free: Apify bills per ad returned. */
const cache = new Map<string, CompetitorAd[]>();

function searchUrl(keyword: string, country: string) {
  const query = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: keyword,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${query}`;
}

function toAd(raw: RawAd): CompetitorAd | null {
  const snapshot = raw.snapshot ?? {};
  const card = snapshot.cards?.[0];
  const imageUrl =
    snapshot.images?.[0]?.resized_image_url ??
    snapshot.images?.[0]?.original_image_url ??
    snapshot.videos?.[0]?.video_preview_image_url ??
    card?.resized_image_url ??
    card?.original_image_url ??
    card?.video_preview_image_url ??
    null;
  const body = (snapshot.body?.text ?? card?.body ?? "").trim();
  // Catalog ads come back as unfilled templates ("{{product.brand}}"): no signal.
  const format = (snapshot.display_format ?? "IMAGE").toLowerCase();
  // Catalog ads (dpa/dco) are product feeds, often unfilled templates
  // ("{{product.brand}}"): they say nothing about a creative angle.
  if (!raw.ad_archive_id || !imageUrl || body.includes("{{") || format === "dpa" || format === "dco") return null;
  const startedMs = (raw.start_date ?? 0) * 1000;
  return {
    id: raw.ad_archive_id,
    page: raw.page_name ?? "Unknown",
    format,
    daysRunning: startedMs ? Math.max(1, Math.round((Date.now() - startedMs) / 86_400_000)) : 0,
    variants: raw.collation_count ?? 1,
    body: body.slice(0, 280),
    cta: snapshot.cta_text ?? null,
    imageUrl,
    libraryUrl: raw.ad_library_url ?? null,
  };
}

/**
 * Active Meta Ad Library ads for a keyword, longest-running first. The library
 * gives no reach or spend outside the EU, so days live and variant count are
 * the winner signal.
 */
export async function searchMetaAds(env: Env, keyword: string, country: string, limit = 30): Promise<CompetitorAd[]> {
  const key = `${country}:${keyword.toLowerCase()}:${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const response = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=90&maxItems=${limit}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.APIFY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        urls: [{ url: searchUrl(keyword, country) }],
        count: limit,
        "scrapePageAds.activeStatus": "active",
        "scrapePageAds.sortBy": "impressions_desc",
        "scrapePageAds.countryCode": country,
      }),
    },
  );
  if (!response.ok) throw new Error(`Ad library search failed (${response.status})`);
  const raw = (await response.json()) as RawAd[];
  const ads = (Array.isArray(raw) ? raw : []).map(toAd).filter((ad): ad is CompetitorAd => ad !== null);
  cache.set(key, ads);
  return ads;
}

/** Merge several keyword searches, one ad per advertiser creative, winners first. */
export function rankAds(groups: CompetitorAd[][], keep = 10): CompetitorAd[] {
  const seen = new Set<string>();
  const perPage = new Map<string, number>();
  const all = groups.flat().sort((a, b) => b.daysRunning + b.variants * 10 - (a.daysRunning + a.variants * 10));
  const picked: CompetitorAd[] = [];
  for (const ad of all) {
    if (seen.has(ad.id)) continue;
    const count = perPage.get(ad.page) ?? 0;
    // At most three per advertiser, so one big spender does not fill the row.
    if (count >= 3) continue;
    seen.add(ad.id);
    perPage.set(ad.page, count + 1);
    picked.push(ad);
    if (picked.length >= keep) break;
  }
  return picked;
}
