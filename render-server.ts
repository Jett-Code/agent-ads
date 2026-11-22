/**
 * Local stand-in for the `agent-voiceover-video` Trigger task: the same
 * pipelines behind two routes, so the prototype makes real videos without a
 * Trigger session.
 *
 * - `voiceover`: ElevenLabs voice, Gemini scenes, ffmpeg edit (about 2 minutes).
 * - `recipe`: a LocalAds video recipe (talking head and other acted formats),
 *   then the speech is changed to the chosen ElevenLabs voice.
 *
 * Run from the repo root so the LocalAds env and path aliases resolve:
 *   bun --env-file=.dev.vars --env-file=apps/agent/.env.local apps/agent/render-server.ts
 */
import { z } from "zod";
import {
  renderVoiceoverVideo,
  revoiceVideo,
  voiceoverVideoPayloadSchema,
} from "./render/voiceover-video";

interface Job {
  /** voice, scenes, editing, filming, revoicing, done or failed. */
  stage: string;
  videoUrl: string | null;
  /** Set when the voice was switched to match the person on screen. */
  voiceName?: string;
  message?: string;
}

const recipeSchema = z.object({
  kind: z.literal("recipe"),
  productId: z.string().uuid(),
  recipeId: z.string().min(2),
  storyIdea: z.string().max(2000),
  language: z.string().default("English"),
  voiceId: z.string().min(5),
  /** The chosen voice's gender, asked of the casting; and the voice to fall back on if the cast differs. */
  voiceGender: z.enum(["man", "woman"]),
  alternate: z.object({ voiceId: z.string().min(5), gender: z.enum(["man", "woman"]), name: z.string() }),
});
const voiceoverSchema = voiceoverVideoPayloadSchema.extend({ kind: z.literal("voiceover") });
const jobSchema = z.discriminatedUnion("kind", [voiceoverSchema, recipeSchema]);

const jobs = new Map<string, Job>();
const PORT = Number(process.env.RENDER_PORT ?? 5198);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function localads<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${process.env.LOCALADS_API_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.LOCALADS_API_KEY}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`LocalAds ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

interface RecipeVideo {
  id: string;
  status: string;
  video_url: string | null;
}

async function runRecipe(id: string, input: z.infer<typeof recipeSchema>): Promise<{ videoUrl: string; voiceName?: string }> {
  const request = {
    type: "recipe",
    product_id: input.productId,
    recipe_id: input.recipeId,
    audience_id: null,
    language: input.language,
    // Cast to the chosen voice, so face and voice agree from the start.
    story_idea: `The creator on camera is a young Indian ${input.voiceGender}. ${input.storyIdea}`.slice(0, 2000),
    max_credits: 15,
  };
  let video: RecipeVideo;
  try {
    // No burnt-in captions. An API that does not know the switch yet refuses it; then render as before.
    video = await localads<RecipeVideo>("/videos", { ...request, subtitles: false });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("LocalAds 400")) throw error;
    video = await localads<RecipeVideo>("/videos", request);
  }
  // Acted recipes take several minutes; give them twenty before giving up.
  for (let attempt = 0; attempt < 150 && !video.video_url; attempt += 1) {
    if (video.status === "failed" || video.status === "canceled") throw new Error("The video did not render.");
    await sleep(8000);
    video = await localads<RecipeVideo>(`/videos/${video.id}`);
  }
  if (!video.video_url) throw new Error("The video took too long to render.");
  jobs.set(id, { stage: "revoicing", videoUrl: null });
  const result = await revoiceVideo({
    videoUrl: video.video_url,
    voiceId: input.voiceId,
    alternate: { voiceId: input.alternate.voiceId, gender: input.alternate.gender },
  });
  return { videoUrl: result.videoUrl, ...(result.usedAlternate ? { voiceName: input.alternate.name } : {}) };
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/render") {
      const parsed = jobSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
      const id = crypto.randomUUID();
      const input = parsed.data;
      jobs.set(id, { stage: input.kind === "recipe" ? "filming" : "voice", videoUrl: null });
      const work: Promise<{ videoUrl: string; voiceName?: string }> =
        input.kind === "recipe"
          ? runRecipe(id, input)
          : renderVoiceoverVideo(input, { onStage: (stage) => jobs.set(id, { stage, videoUrl: null }) });
      work
        .then((result) => jobs.set(id, { stage: "done", videoUrl: result.videoUrl, voiceName: result.voiceName }))
        .catch((error: unknown) =>
          jobs.set(id, {
            stage: "failed",
            videoUrl: null,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      return Response.json({ id }, { status: 202 });
    }
    if (request.method === "GET" && pathname.startsWith("/render/")) {
      const job = jobs.get(pathname.slice("/render/".length));
      return job ? Response.json(job) : new Response("Not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  },
});
