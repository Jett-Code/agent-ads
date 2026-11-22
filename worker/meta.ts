import type { LaunchedAd, LaunchedAdSet, LaunchResult } from "../src/shared/types";
import type { Env } from "./env";

/**
 * Creates a paused campaign, its ad sets and ads on Meta through Treg
 * (treg.to), which holds the Facebook login and injects its token into Graph
 * API calls. The same call sequence as LocalAds' own publish
 * (src/features/meta-ads/server/services/meta-publish.ts), kept to the
 * traffic objective so no pixel is needed.
 */

const TREG = "https://treg.to";

/** Base64 of raw bytes, in chunks so a large image does not overflow the call stack. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

interface LaunchInput {
  campaignName: string;
  dailyBudget: number;
  adSets: { name: string; creativeIds: string[] }[];
  primaryText: string;
  headline: string;
  cta: string;
  destinationUrl: string;
  country: string;
  imageUrls: Map<string, string | null>;
}

interface GraphError {
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  code?: number;
}

async function treg<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${TREG}${path}`, { headers: { "X-Treg-Token": env.TREG_API_KEY ?? "" } });
  if (!response.ok) throw new Error(`Treg request failed (${response.status})`);
  return (await response.json()) as T;
}

/** One Graph API call as the connected Facebook profile. */
async function graph<T>(
  env: Env,
  connection: string,
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const params = new URLSearchParams({ ...init.query, suppress_http_code: "1" });
  const response = await fetch(`${TREG}/call/${connection}/${path}?${params}`, {
    method: init.method ?? "GET",
    headers: {
      "X-Treg-Token": env.TREG_API_KEY ?? "",
      ...(init.body ? { "content-type": "application/json", "X-Treg-Body-Encoding": "base64" } : {}),
    },
    body: init.body ? base64(new TextEncoder().encode(JSON.stringify(init.body))) : undefined,
  });
  if (!response.ok) throw new Error(`Treg request failed (${response.status})`);
  const result = (await response.json()) as T & { error?: GraphError };
  if (result?.error && typeof result.error === "object") {
    const error = result.error;
    throw new Error(error.error_user_msg ?? error.error_user_title ?? error.message ?? `Meta refused (code ${error.code})`);
  }
  return result;
}

async function resolveAccount(env: Env) {
  const connections = await treg<{ name: string; provider: string; needs_reconnect: boolean }[]>(env, "/connections");
  const connection = env.META_CONNECTION
    ? connections.find((entry) => entry.name === env.META_CONNECTION)
    : connections.find((entry) => entry.provider === "meta-ads" && !entry.needs_reconnect);
  if (!connection) throw new Error("No Meta connection found in Treg.");

  const accounts = await graph<{ data: { id: string; name: string; currency: string; account_status: number }[] }>(
    env,
    connection.name,
    "me/adaccounts",
    { query: { fields: "id,name,currency,account_status", limit: "50" } },
  );
  const account = env.META_AD_ACCOUNT_ID
    ? accounts.data.find((entry) => entry.id === env.META_AD_ACCOUNT_ID || entry.id === `act_${env.META_AD_ACCOUNT_ID}`)
    : (accounts.data.find((entry) => entry.account_status === 1) ?? accounts.data[0]);
  if (!account) throw new Error("The connected profile has no ad account.");

  // Pages this ad account may advertise for. The Treg login asks for ads
  // scopes only, so the profile's own page list (me/accounts) can be empty.
  const list = (path: string) =>
    graph<{ data?: { id: string; name: string }[] }>(env, connection.name, path, {
      query: { fields: "id,name", limit: "50" },
    })
      .then((result) => result.data ?? [])
      .catch(() => []);
  const promotable = await list(`${account.id}/promote_pages`);
  const pages = promotable.length ? promotable : await list("me/accounts");
  // A pinned page may not be in either list; ask Meta for its name directly.
  const pinnedId = env.META_PAGE_ID;
  let pinned = pinnedId ? pages.find((entry) => entry.id === pinnedId) : undefined;
  if (pinnedId && !pinned) {
    pinned = await graph<{ id: string; name?: string }>(env, connection.name, pinnedId, { query: { fields: "id,name" } })
      .then((entry) => ({ id: entry.id, name: entry.name?.trim() || "Page" }))
      .catch(() => ({ id: pinnedId, name: "Page" }));
  }
  const page = pinned ?? pages[0];
  if (!page) throw new Error("The connected profile has no Facebook Page to run ads from.");

  return { connection: connection.name, account, page };
}

export async function launchOnMeta(env: Env, input: LaunchInput): Promise<LaunchResult> {
  const { connection, account, page } = await resolveAccount(env);
  const post = <T>(path: string, body: Record<string, unknown>) =>
    graph<T>(env, connection, path, { method: "POST", body });

  // Paused, with one campaign budget: nothing spends until someone turns it on.
  const campaign = await post<{ id: string }>(`${account.id}/campaigns`, {
    name: input.campaignName,
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: [],
    daily_budget: Math.round(input.dailyBudget * 100),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  });

  try {
    // Uploads, ad sets and ads each go out together: one after another, a
    // four-ad launch spent most of a minute waiting on round trips.
    const uploads = await Promise.all(
      [...input.imageUrls].map(async ([creativeId, imageUrl]) => {
        if (!imageUrl) return null;
        const image = await fetch(imageUrl);
        if (!image.ok) return null;
        const uploaded = await post<{ images?: Record<string, { hash?: string }> }>(`${account.id}/adimages`, {
          bytes: base64(new Uint8Array(await image.arrayBuffer())),
        });
        const hash = Object.values(uploaded.images ?? {})[0]?.hash;
        return hash ? ([creativeId, hash] as const) : null;
      }),
    );
    const hashes = new Map(uploads.filter((entry) => entry !== null));

    const adSets: LaunchedAdSet[] = await Promise.all(
      input.adSets.map(async (plan) => {
        const adSet = await post<{ id: string }>(`${account.id}/adsets`, {
          name: plan.name,
          campaign_id: campaign.id,
          // Active inside a paused campaign: the campaign is the single switch.
          status: "ACTIVE",
          billing_event: "IMPRESSIONS",
          optimization_goal: "LINK_CLICKS",
          destination_type: "WEBSITE",
          targeting: {
            geo_locations: { countries: [input.country] },
            age_min: 18,
            age_max: 65,
            targeting_automation: { advantage_audience: 1 },
          },
        });
        const made = await Promise.all(
          plan.creativeIds.map(async (creativeId): Promise<LaunchedAd | null> => {
            const hash = hashes.get(creativeId);
            if (!hash) return null;
            const name = `${plan.name} · ${creativeId.slice(0, 6)}`;
            const creative = await post<{ id: string }>(`${account.id}/adcreatives`, {
              name,
              object_story_spec: {
                page_id: page.id,
                link_data: {
                  image_hash: hash,
                  link: input.destinationUrl,
                  message: input.primaryText,
                  name: input.headline,
                  call_to_action: { type: input.cta, value: { link: input.destinationUrl } },
                },
              },
            });
            const ad = await post<{ id: string }>(`${account.id}/ads`, {
              name,
              adset_id: adSet.id,
              creative: { creative_id: creative.id },
              status: "ACTIVE",
            });
            return { id: ad.id, name, status: "CAMPAIGN_PAUSED", creativeId };
          }),
        );
        return { id: adSet.id, name: plan.name, status: "CAMPAIGN_PAUSED", ads: made.filter((ad) => ad !== null) };
      }),
    );

    const adsCreated = adSets.reduce((sum, adSet) => sum + adSet.ads.length, 0);
    if (!adsCreated) throw new Error("Meta accepted the campaign but none of the ads.");

    // Read the statuses back from Meta, so the card shows what is really there.
    const live = await graph<{
      effective_status?: string;
      adsets?: { data: { id: string; effective_status?: string; ads?: { data: { id: string; effective_status?: string }[] } }[] };
    }>(env, connection, campaign.id, {
      query: { fields: "effective_status,adsets{effective_status,ads{effective_status}}" },
    }).catch(() => null);
    const liveSets = new Map((live?.adsets?.data ?? []).map((entry) => [entry.id, entry]));
    const confirmed = adSets.map((adSet) => {
      const liveSet = liveSets.get(adSet.id);
      const liveAds = new Map((liveSet?.ads?.data ?? []).map((entry) => [entry.id, entry.effective_status]));
      return {
        ...adSet,
        status: liveSet?.effective_status ?? adSet.status,
        ads: adSet.ads.map((ad) => ({ ...ad, status: liveAds.get(ad.id) ?? ad.status })),
      };
    });

    const accountNumber = account.id.replace(/^act_/, "");
    return {
      ok: true,
      status: "launched",
      message: "Created on Meta, paused.",
      accountName: account.name,
      // The ads-only login cannot always read the Page's name; the account name stands in.
      pageName: page.name === "Page" ? account.name : page.name,
      campaign: {
        id: campaign.id,
        name: input.campaignName,
        status: live?.effective_status ?? "PAUSED",
        dailyBudget: input.dailyBudget,
        currency: account.currency,
        objective: "Traffic",
      },
      adSets: confirmed,
      adsCreated,
      copy: {
        primaryText: input.primaryText,
        headline: input.headline,
        cta: input.cta,
        destinationUrl: input.destinationUrl,
      },
      managerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountNumber}&selected_campaign_ids=${campaign.id}`,
    };
  } catch (error) {
    // A half-built campaign is worse than none: deleting it takes its ad sets and ads along.
    await graph(env, connection, campaign.id, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
