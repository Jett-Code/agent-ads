import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import type { VideoStatus } from "../src/shared/types";
import { VOICES, type VoiceKey } from "../src/shared/voices";
import type { Env } from "./env";
import { agentModel } from "./model";
import { buildTools, DEFAULT_RENDER_URL } from "./tools";

const SYSTEM = `You are an autonomous ads agent. The person gives one instruction and you run the whole job: research, angles, creatives, campaign structure, launch. You never ask questions in text and never wait for another message. The only pauses are the four review tools, and each one carries your recommendation.

Run these steps in order:
1. find_product.
2. In ONE step, call scan_competitor_ads and research_market together.
3. choose_angles: 4 angles grounded in what the research showed (cite the competitor or trend in "why"). Recommend the best 2 or 3.
4. choose_voice: recommend the voice that fits the buyer and the top angle.
5. In ONE step, call make_statics (6 creatives, 4:5) and make_video together, using only the chosen angles. The video uses the top chosen angle and the chosen voice: a 30 to 45 word script and 3 scenes. Video format: what the person asked for (claymation, UGC, talking head); showcase if they named none.
6. pick_creatives: recommend the 3 or 4 highest-scoring creative ids.
7. approve_plan: one Meta campaign, 1 to 3 ad sets that split the chosen creatives by audience or angle, objective OUTCOME_TRAFFIC, a sensible daily budget in INR, primary text, headline and CTA. Split by angle, not by audience. Use the product's page as the destination.
8. launch_meta with exactly what was approved.
Only make claims (protein grams, prices, discounts) that the product description or the person's message supports.
9. End with one line on what is live or what is blocked.

Rules:
- Write almost nothing. At most one sentence of under 12 words before a step, and none is fine. Never restate tool results; the screen already shows them.
- Never use emojis or em dashes.
- If a review tool returns different choices than you recommended, follow the person's choice.
- If a tool fails, say so in one short line and carry on with what you have. If find_product fails, stop and say what is missing.
- Never claim an ad is live unless launch_meta said it launched.`;

async function chat(request: Request, env: Env): Promise<Response> {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const tools = buildTools(env);
  const result = streamText({
    model: agentModel(env),
    system: SYSTEM,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(24),
    abortSignal: request.signal,
  });
  return result.toUIMessageStreamResponse({
    sendReasoning: false,
    onError: (error) => (error instanceof Error ? error.message : "The agent hit a problem."),
  });
}

/** Where the voiceover video stands, for the card that polls it. */
async function videoStatus(env: Env, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const response = await fetch(`${env.RENDER_URL ?? DEFAULT_RENDER_URL}/render/${id}`);
  if (!response.ok) return new Response("Not found", { status: 404 });
  const body = (await response.json()) as VideoStatus;
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

/** A voice's sample clip, so the picker can play it without exposing the key. */
async function voicePreview(env: Env, key: string): Promise<Response> {
  const voice = VOICES[key as VoiceKey];
  if (!voice) return new Response("Not found", { status: 404 });
  const details = await fetch(`https://api.elevenlabs.io/v1/voices/${voice.id}`, {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  const { preview_url: previewUrl } = (await details.json()) as { preview_url?: string };
  if (!previewUrl) return new Response("Not found", { status: 404 });
  const audio = await fetch(previewUrl, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
  return new Response(audio.body, {
    status: audio.status,
    headers: { "content-type": audio.headers.get("content-type") ?? "audio/mpeg", "cache-control": "public, max-age=86400" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/chat" && request.method === "POST") return await chat(request, env);
      if (pathname.startsWith("/api/voice-preview/")) return await voicePreview(env, pathname.slice("/api/voice-preview/".length));
      if (pathname.startsWith("/api/video/")) return await videoStatus(env, pathname.slice("/api/video/".length));
      if (pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unexpected error";
      return Response.json({ error: detail }, { status: 500 });
    }
    return env.ASSETS.fetch(request);
  },
};
