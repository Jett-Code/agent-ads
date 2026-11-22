import { generateObject, generateText, tool } from "ai";
import { z } from "zod";
import type {
  CompetitorResult,
  LaunchResult,
  MarketResult,
  ProductResult,
  StaticCreative,
  StaticsResult,
  VideoResult,
} from "../src/shared/types";
import { VOICE_KEYS, VOICES } from "../src/shared/voices";
import { rankAds, searchMetaAds } from "./apify";
import type { Env } from "./env";
import { listBrands, localads, sleep, type Brand, type Campaign, type Product } from "./localads";
import { agentModel, google, SEARCH_MODEL } from "./model";
import { launchOnMeta } from "./meta";

export const DEFAULT_RENDER_URL = "http://127.0.0.1:5198";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "Avvatar" and "avatar" should match: lowercase, letters only, no doubled letters. */
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/(.)\1+/g, "$1");

const words = (text: string) => squash(text).split(/\s+/).filter((word) => word.length > 2);

function overlap(query: string, name: string) {
  const wanted = new Set(words(query));
  const have = words(name);
  if (!have.length) return 0;
  return have.filter((word) => wanted.has(word)).length / have.length;
}

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

function productView(product: Product, brand: Brand): NonNullable<ProductResult["product"]> {
  return {
    id: product.id,
    name: product.name,
    description: product.description ? product.description.slice(0, 700) : null,
    imageUrl: product.image_urls[0] ?? null,
    brandName: brand.name,
    sourceUrl: product.source_url ?? brand.website_url,
  };
}

async function productFromUrl(env: Env, url: string, callId: string) {
  const brands = await listBrands(env);
  const host = hostOf(url);
  let brand = brands.find((candidate) => hostOf(candidate.website_url) === host);
  if (!brand) {
    const name = (host ?? "Brand").split(".")[0];
    brand = await localads<Brand>(env, "/brands", {
      body: { name: name.charAt(0).toUpperCase() + name.slice(1), website_url: new URL(url).origin },
    });
  }
  const product = await localads<Product>(env, "/products", {
    body: { brand_id: brand.id, source_url: url },
    idempotencyKey: callId,
  });
  return { brand, product };
}

async function productFromName(env: Env, query: string) {
  const brands = await listBrands(env);
  const squashed = squash(query);
  const candidates = brands
    .filter((brand) => (brand.product_count ?? 1) > 0)
    .map((brand) => ({ brand, hit: squashed.includes(squash(brand.name).trim()) ? 1 : overlap(query, brand.name) }))
    .filter((entry) => entry.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, 4);
  let best: { brand: Brand; product: Product; score: number } | null = null;
  for (const { brand, hit } of candidates) {
    const page = await localads<{ data: Product[] }>(env, `/products?brand_id=${brand.id}&limit=100`);
    for (const product of page.data) {
      const score = overlap(query, product.name) + hit;
      if (!best || score > best.score) best = { brand, product, score };
    }
  }
  return best;
}

export function buildTools(env: Env) {
  return {
    find_product: tool({
      description:
        "Find the product to advertise in the workspace by name, or import it from its page URL. Always the first step.",
      inputSchema: z.object({
        query: z.string().describe("Brand and product name as the person wrote it"),
        url: z.string().url().optional().describe("The product page, only if the person gave one"),
      }),
      async *execute({ query, url }, { toolCallId }): AsyncGenerator<ProductResult> {
        try {
          if (!url) {
            yield { ok: true, stage: "searching" };
            const found = await productFromName(env, query);
            if (!found) {
              yield { ok: false, stage: "failed", message: `No product matching "${query}" in this workspace.` };
              return;
            }
            yield { ok: true, stage: "ready", product: productView(found.product, found.brand) };
            return;
          }
          yield { ok: true, stage: "reading" };
          const { brand, product: created } = await productFromUrl(env, url, toolCallId);
          let product = created;
          for (let attempt = 0; attempt < 45 && product.status === "processing"; attempt += 1) {
            await sleep(4000);
            product = await localads<Product>(env, `/products/${product.id}`);
          }
          if (product.status === "failed") {
            yield { ok: false, stage: "failed", message: "Could not read that product page." };
            return;
          }
          yield { ok: true, stage: "ready", product: productView(product, brand) };
        } catch (error) {
          yield { ok: false, stage: "failed", message: message(error) };
        }
      },
    }),

    scan_competitor_ads: tool({
      description:
        "Search the Meta Ad Library for ads competitors are running now. Returns the longest-running ads (the winners). Call together with research_market.",
      inputSchema: z.object({
        keywords: z
          .array(z.string())
          .min(1)
          .describe("One or two category searches a shopper would type, e.g. 'whey protein'. Not the person's own brand."),
        country: z.string().default("IN").describe("Two-letter ISO country code of the market, e.g. IN"),
      }),
      async *execute(input): AsyncGenerator<CompetitorResult> {
        // Lenient on purpose: a model that sends "India" or three keywords should still get results.
        const keywords = input.keywords.slice(0, 2);
        const country = /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : "IN";
        yield { ok: true, stage: "scanning", keywords, scanned: 0, ads: [] };
        try {
          const groups = await Promise.all(keywords.map((keyword) => searchMetaAds(env, keyword, country)));
          const ads = rankAds(groups);
          yield { ok: true, stage: "done", keywords, scanned: groups.flat().length, ads };
        } catch (error) {
          yield { ok: false, stage: "failed", keywords, scanned: 0, ads: [], message: message(error) };
        }
      },
    }),

    research_market: tool({
      description:
        "Web research on current trends and the seasonal moment for this product category. Call together with scan_competitor_ads.",
      inputSchema: z.object({
        product: z.string(),
        category: z.string(),
        moment: z.string().describe("The occasion or week the ads are for, e.g. 'Black Friday week'"),
        country: z.string().default("India"),
      }),
      async *execute({ product, category, moment, country }): AsyncGenerator<MarketResult> {
        const empty = { trends: [], season: null, hooks: [], sources: [] };
        yield { ok: true, stage: "searching", ...empty };
        try {
          const result = await generateText({
            model: google(env)(SEARCH_MODEL),
            tools: { google_search: google(env).tools.googleSearch({}) },
            prompt: `Today is ${new Date().toDateString()}. Research the ${category} market in ${country} for advertising "${product}" during ${moment}.
Reply with JSON only, no prose, in this exact shape:
{"trends":[{"title":"3-5 words","why":"one short sentence with a concrete fact"}],"season":{"moment":"name of the seasonal moment","when":"dates","insight":"one sentence on how shoppers behave then"},"hooks":["short ad hook"],"sources":["domain.com"]}
Give exactly 3 trends, 3 hooks, up to 4 sources. Keep every string short.`,
          });
          const json = result.text.match(/\{[\s\S]*\}/)?.[0];
          const parsed = JSON.parse(json ?? "{}") as Partial<MarketResult>;
          yield {
            ok: true,
            stage: "done",
            trends: (parsed.trends ?? []).slice(0, 3),
            season: parsed.season ?? null,
            hooks: (parsed.hooks ?? []).slice(0, 3),
            sources: (parsed.sources ?? []).slice(0, 4),
          };
        } catch (error) {
          yield { ok: false, stage: "failed", ...empty, message: message(error) };
        }
      },
    }),

    choose_angles: tool({
      description:
        "Show the creative angles and wait for the person to confirm. Always mark your recommended ones; they are pre-selected. Returns the chosen angle ids.",
      inputSchema: z.object({
        angles: z
          .array(
            z.object({
              id: z.string(),
              title: z.string().describe("2-4 words"),
              hook: z.string().describe("The ad's opening line, under 12 words"),
              why: z.string().describe("Evidence from the research, under 14 words"),
              format: z.enum(["static", "video", "both"]),
              score: z.number().int().min(0).max(100).describe("Whole number from 0 to 100: how likely this angle is to win"),
            }),
          )
          .min(3)
          .max(5),
        recommended: z.array(z.string()).min(1).max(3).describe("Ids of the angles you recommend"),
      }),
    }),

    make_statics: tool({
      description:
        "Generate static ad creatives for the chosen angles with LocalAds. Waits until they are rendered and scored. Costs 2 credits per creative.",
      inputSchema: z.object({
        productId: z.string(),
        angles: z.array(z.string().max(280)).min(1).max(4).describe("One line per chosen angle: title plus hook"),
        brief: z.string().max(900).describe("Occasion, offer and tone for all the creatives"),
        count: z.number().int().min(2).max(8).default(6),
        aspectRatio: z.enum(["1:1", "4:5", "9:16"]).default("4:5"),
      }),
      async *execute({ productId, angles, brief, count, aspectRatio }, { toolCallId }): AsyncGenerator<StaticsResult> {
        yield { ok: true, stage: "starting", total: count, creatives: [] };
        try {
          const blueprints = await localads<{ data: { id: string }[] }>(
            env,
            `/campaign-blueprints?product_id=${productId}`,
          );
          const blueprint =
            blueprints.data.find((entry) => entry.id === "viral-pattern-interrupt") ?? blueprints.data[0];
          let campaign = await localads<Campaign>(env, "/campaigns", {
            body: {
              product_id: productId,
              mode: "guided",
              blueprint_id: blueprint?.id,
              audience_id: null,
              angles,
              brief,
              aspect_ratio: aspectRatio,
              creative_count: count,
              max_credits: count * 2,
            },
            idempotencyKey: toolCallId,
          });
          const view = (): StaticCreative[] =>
            campaign.creatives.map((creative) => ({
              id: creative.id,
              imageUrl: creative.image_url,
              status: creative.status,
            }));
          // Up to about eight minutes; a campaign of six usually lands well inside that.
          for (let attempt = 0; attempt < 120; attempt += 1) {
            yield { ok: true, stage: "rendering", campaignId: campaign.id, total: count, creatives: view() };
            if (campaign.status !== "queued" && campaign.status !== "in_progress") break;
            await sleep(4000);
            campaign = await localads<Campaign>(env, `/campaigns/${campaign.id}`);
          }
          const done = view().filter((creative) => creative.imageUrl);
          if (!done.length) {
            yield { ok: false, stage: "failed", campaignId: campaign.id, total: count, creatives: [], message: "No creatives rendered." };
            return;
          }
          yield { ok: true, stage: "scoring", campaignId: campaign.id, total: count, creatives: done };
          const scored = await scoreCreatives(env, done, brief);
          yield {
            ok: true,
            stage: "done",
            campaignId: campaign.id,
            total: count,
            creatives: scored,
            creditsCharged: campaign.credits_charged,
          };
        } catch (error) {
          yield { ok: false, stage: "failed", total: count, creatives: [], message: message(error) };
        }
      },
      // The model needs ids and scores, not signed image URLs.
      toModelOutput: ({ output }) => ({
        type: "json",
        value: {
          ok: output.ok,
          stage: output.stage,
          message: output.message ?? null,
          creatives: output.creatives.map(({ id, score, note }) => ({ id, score: score ?? null, note: note ?? null })),
        },
      }),
    }),

    choose_voice: tool({
      description:
        "Show the four voices for the video ad and wait for the person to pick one. Your recommended voice is pre-selected. Returns the chosen voice.",
      inputSchema: z.object({
        recommended: z.enum(VOICE_KEYS).describe(
          `The voice that fits the product's buyer and the angle. ${Object.entries(VOICES)
            .map(([key, voice]) => `${key}: ${voice.blurb}`)
            .join("; ")}`,
        ),
        reason: z.string().describe("Why this voice, under 10 words"),
      }),
    }),

    make_video: tool({
      description:
        "Start one video ad in the chosen voice. Returns at once; the video keeps rendering on screen. Call together with make_statics. Formats: showcase, claymation and ugc-voiceover take about 2 minutes (the voice narrates over filmed scenes); talking-head takes several minutes (a creator speaks to camera).",
      inputSchema: z.object({
        productId: z.string(),
        format: z
          .enum(["showcase", "claymation", "ugc-voiceover", "talking-head"])
          .describe("Use what the person asked for. If they named no format, use showcase."),
        script: z
          .string()
          .max(420)
          .describe("The spoken words, 30 to 45 words, hook first, offer last. Plain sentences, no stage directions. Only claims the product description supports."),
        voice: z.enum(VOICE_KEYS).describe("The voice choose_voice returned"),
        scenes: z
          .array(z.string().max(300))
          .min(2)
          .max(3)
          .describe("One line per scene, in order: what the camera shows, e.g. 'a scoop lifts creamy powder from the open tub in a sunlit kitchen'"),
      }),
      execute: async ({ productId, format, script, voice, scenes }): Promise<VideoResult> => {
        try {
          const product = await localads<Product>(env, `/products/${productId}`);
          const imageUrl = product.image_urls[0];
          if (!imageUrl) return { ok: false, script, message: "The product has no photo to film." };
          const job =
            format === "talking-head"
              ? {
                  kind: "recipe",
                  productId,
                  recipeId: "ugc-talking-head",
                  storyIdea: `The creator says, close to word for word: "${script}" Scenes: ${scenes.join(" Then ")}`,
                  voiceId: VOICES[voice].id,
                  voiceGender: VOICES[voice].gender,
                  // If the recipe still casts the other gender, this voice is used instead.
                  alternate: {
                    voiceId: VOICES[VOICES[voice].counterpart].id,
                    gender: VOICES[VOICES[voice].counterpart].gender,
                    name: VOICES[VOICES[voice].counterpart].name,
                  },
                }
              : {
                  kind: "voiceover",
                  style: format === "ugc-voiceover" ? "ugc" : format,
                  script,
                  voiceId: VOICES[voice].id,
                  imageUrl,
                  scenes,
                };
          const response = await fetch(`${env.RENDER_URL ?? DEFAULT_RENDER_URL}/render`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(job),
          });
          if (!response.ok) return { ok: false, script, message: `The video service refused the job (${response.status}).` };
          const started = (await response.json()) as { id: string };
          return { ok: true, jobId: started.id, script, voiceName: VOICES[voice].name, format };
        } catch (error) {
          return { ok: false, script, message: message(error) };
        }
      },
    }),

    pick_creatives: tool({
      description:
        "Show the finished creatives and wait for the person to confirm which ones go live. Your recommended ones are pre-selected. Returns the chosen creative ids.",
      inputSchema: z.object({
        recommended: z.array(z.string()).min(1).describe("Creative ids you recommend, best first"),
        reason: z.string().describe("Why these, under 12 words"),
      }),
    }),

    approve_plan: tool({
      description:
        "Show the Meta campaign structure (campaign, ad sets, ads) with budget and copy, and wait for the person to approve the launch.",
      inputSchema: z.object({
        platform: z.literal("meta"),
        campaign: z.object({
          name: z.string(),
          objective: z.enum(["OUTCOME_SALES", "OUTCOME_TRAFFIC"]),
          dailyBudget: z.number().describe("Total per day, in the currency's main unit"),
          currency: z.string().default("INR"),
        }),
        adSets: z
          .array(
            z.object({
              name: z.string().describe("2-4 words"),
              audience: z.string().describe("Who it targets, under 10 words"),
              placements: z.string().describe("e.g. 'Feed + Reels'"),
              creativeIds: z.array(z.string()).min(1),
            }),
          )
          .min(1)
          .max(3),
        primaryText: z.string().max(300),
        headline: z.string().max(60),
        cta: z.enum(["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "GET_OFFER"]),
        destinationUrl: z.string(),
        why: z.string().describe("Why this structure, under 16 words"),
      }),
    }),

    launch_meta: tool({
      description:
        "Create the approved campaign, its ad sets and ads on Meta, all paused. Only after approve_plan returned approved.",
      inputSchema: z.object({
        campaignName: z.string(),
        dailyBudget: z.number().describe("Per day, in the ad account's main currency unit"),
        adSets: z.array(z.object({ name: z.string(), creativeIds: z.array(z.string()).min(1) })).min(1).max(3),
        primaryText: z.string(),
        headline: z.string(),
        cta: z.enum(["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "GET_OFFER"]),
        destinationUrl: z.string(),
        country: z.string().default("IN").describe("Two-letter ISO country code to target"),
      }),
      execute: async (input): Promise<LaunchResult> => {
        if (!env.TREG_API_KEY) {
          // Never fake a launch: say plainly that nothing was created.
          return { ok: false, status: "not_connected", message: "Meta is not connected yet." };
        }
        try {
          const ids = [...new Set(input.adSets.flatMap((adSet) => adSet.creativeIds))];
          const found = await Promise.all(
            ids.map(async (id) => {
              const creative = await localads<{ id: string; image_url: string | null }>(env, `/creatives/${id}`);
              return [id, creative.image_url] as const;
            }),
          );
          return await launchOnMeta(env, { ...input, imageUrls: new Map(found) });
        } catch (error) {
          return { ok: false, status: "failed", message: message(error) };
        }
      },
    }),
  };
}

/** One vision pass over the finished creatives, so the recommendation has a basis. */
async function scoreCreatives(env: Env, creatives: StaticCreative[], brief: string): Promise<StaticCreative[]> {
  try {
    const { object } = await generateObject({
      model: agentModel(env),
      schema: z.object({
        scores: z.array(
          z.object({
            index: z.number().int(),
            score: z.number().min(0).max(100),
            note: z.string().describe("Under 8 words: the creative's strongest or weakest trait"),
          }),
        ),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Score each ad creative 0-100 as a Meta feed ad for this brief: ${brief}\nJudge thumb-stop power, a readable offer, and product clarity. Images are numbered from 0 in order.`,
            },
            ...creatives.map((creative) => ({ type: "image" as const, image: new URL(creative.imageUrl as string) })),
          ],
        },
      ],
    });
    return creatives
      .map((creative, index) => {
        const hit = object.scores.find((entry) => entry.index === index);
        return hit ? { ...creative, score: Math.round(hit.score), note: hit.note } : creative;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  } catch {
    // Unscored creatives are still usable; the gate just shows no ranking.
    return creatives;
  }
}
