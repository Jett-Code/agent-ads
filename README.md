# Agent Ads

A chat agent that plans and launches a Meta ad campaign from one prompt, such as
"create this week's Black Friday ads for my whey protein". Built for a hackathon.

## What it does

1. **Research:** pulls competitors' live ads from the Meta Ad Library (Apify) and
   ranks them by days running and variant count, then gathers market trends and
   seasonality with a web-grounded search.
2. **Angles:** proposes creative buckets with scores; you approve the ones to make.
3. **Creatives:** six static ads, scored by a vision pass, plus a video ad.
4. **Video:** pick one of four ElevenLabs voices and a format (showcase,
   claymation, UGC voiceover or talking head). The render service has ElevenLabs
   speak the script with word timings, animates the product photo into scenes and
   cuts them to the voice with ffmpeg into one 1080x1920 file.
5. **Launch:** creates a paused campaign, ad sets and ads in Meta through Treg,
   and shows the structure in a card with a link to Ads Manager.

Every step shows up live as a card under the chat. Each review step auto-continues
after 30 seconds.

## Layout

| Path | What |
|---|---|
| `src/` | React UI (Halaska UI kit), one card per step |
| `worker/` | Agent loop and tools (AI SDK): research, creatives, video, Meta launch |
| `render-server.ts` | Local video render service (Bun) |
| `render/voiceover-video.ts` | Voice, scene and ffmpeg pipeline |

## Run

```sh
bun install
cp .env.example .env.local   # fill in keys
bun run dev                  # UI + worker
bun render-server.ts         # video render service
```

`render/voiceover-video.ts` uses a host app's video-model provider, env loader and
object storage (`@/features/...`, `@/server/...`). Those adapters are not included
in this repo.
