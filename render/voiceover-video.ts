import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { generateGeminiOmniVideo } from "@/features/generation/video/server/services/providers/gemini-omni";
import { appEnv } from "@/server/env/node-env";
import { uploadObjectToStorage } from "@/server/services/object-storage";

/**
 * A voiceover video ad for the agent prototype (apps/agent): ElevenLabs speaks
 * the script, Gemini Omni animates the product into a few scenes, and ffmpeg
 * cuts them to the voice with burnt-in captions. The video-ads formats let the
 * video model speak; here the voice is its own step, so any ElevenLabs voice
 * (or a cloned one) can be used. Nothing is charged or saved to a workspace.
 */

const execFileAsync = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH ?? "ffmpeg";
const VIDEO_MODEL = "google:gemini-omni-1.1-flash";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

export const voiceoverVideoPayloadSchema = z.object({
  script: z.string().min(10).max(600),
  /** An ElevenLabs voice id. */
  voiceId: z.string().min(5),
  /** The product photo every scene is built from. */
  imageUrl: z.string().url(),
  /** What happens in each scene, in order. */
  scenes: z.array(z.string().min(5).max(400)).min(1).max(3),
  /** The look every scene is filmed in. */
  style: z.enum(["showcase", "claymation", "ugc"]).default("showcase"),
  /** Burn captions timed to the voice into the picture. Off for now. */
  captions: z.boolean().default(false),
});

const STYLE_DIRECTION: Record<z.infer<typeof voiceoverVideoPayloadSchema>["style"], string> = {
  showcase: "Polished product film: clean light, shallow depth of field, slow deliberate camera moves.",
  claymation:
    "Stop-motion claymation: the whole scene, the props and any people are handmade from modelling clay with visible fingerprints, on a miniature set, with slightly jerky stop-motion movement. The product is a clay model that keeps its real shape, colours and label.",
  ugc: "Authentic phone footage a customer filmed themselves: handheld, natural light, a real home or gym, slightly imperfect framing, nothing polished. Any person who appears is an ordinary young Indian adult and never talks to the camera.",
};

interface Word {
  text: string;
  start: number;
  end: number;
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** ElevenLabs times every character; captions need words. */
function toWords(alignment: Alignment): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;
  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    const start = alignment.character_start_times_seconds[index] ?? 0;
    const end = alignment.character_end_times_seconds[index] ?? start;
    current = current ? { ...current, text: current.text + character, end } : { text: character, start, end };
  });
  if (current) words.push(current);
  return words;
}

async function speak(script: string, voiceId: string): Promise<{ audio: Buffer; words: Word[] }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text: script, model_id: "eleven_v4" }),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs refused the voiceover (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const result = (await response.json()) as { audio_base64: string; alignment: Alignment | null };
  return {
    audio: Buffer.from(result.audio_base64, "base64"),
    words: result.alignment ? toWords(result.alignment) : [],
  };
}

const assTime = (seconds: number) => {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${(total % 60).toFixed(2).padStart(5, "0")}`;
};

/** Three words at a time, big and centred low: the short-form caption look. */
function captions(words: Word[]): string {
  const lines: string[] = [];
  for (let index = 0; index < words.length; index += 3) {
    const group = words.slice(index, index + 3);
    const text = group
      .map((word) => word.text)
      .join(" ")
      .replace(/[{}\\]/g, "");
    lines.push(`Dialogue: 0,${assTime(group[0].start)},${assTime(group[group.length - 1].end + 0.08)},Cap,,0,0,0,,${text}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Cap,DejaVu Sans,92,&H00FFFFFF,&H00000000,&H64000000,-1,1,6,2,2,80,80,420

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

async function duration(file: string): Promise<number> {
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return Number.parseFloat(stdout.trim()) || 0;
}

export type VoiceoverVideoPayload = z.infer<typeof voiceoverVideoPayloadSchema>;
export type VoiceoverVideoStage = "voice" | "scenes" | "editing" | "done";

export async function renderVoiceoverVideo(
  payload: VoiceoverVideoPayload,
  options: { onStage?: (stage: VoiceoverVideoStage) => void; signal?: AbortSignal } = {},
): Promise<{ videoUrl: string; seconds: number; scenes: number }> {
  const onStage = options.onStage ?? (() => undefined);
  const signal = options.signal;
  const dir = await mkdtemp(join(tmpdir(), "agent-video-"));
  try {
    onStage("voice");
    const voicePath = join(dir, "voice.mp3");
    const { audio, words } = await speak(payload.script, payload.voiceId);
    await writeFile(voicePath, audio);
    const voiceSeconds = await duration(voicePath);

    onStage("scenes");
    // Scenes share the voice's length, within what Omni can make in one clip.
    const sceneSeconds = Math.min(10, Math.max(4, Math.ceil(voiceSeconds / payload.scenes.length)));
    const rendered = await Promise.allSettled(
      payload.scenes.map((scene) =>
        generateGeminiOmniVideo(
          appEnv,
          {
            modelId: VIDEO_MODEL,
            prompt: `${scene}\n${STYLE_DIRECTION[payload.style]}\nVertical video for a social ad. Keep the product recognisably the one in the reference photo: same pack, label and colours. No on-screen text, no captions, no logos added, no speech.`,
            referenceImageUrls: [payload.imageUrl],
            aspectRatio: "9:16",
            durationSeconds: sceneSeconds,
          },
          { signal },
        ),
      ),
    );
    const clips: string[] = [];
    for (const [index, result] of rendered.entries()) {
      if (result.status !== "fulfilled") continue;
      const clipPath = join(dir, `scene-${index}.mp4`);
      await writeFile(clipPath, result.value.video.bytes);
      clips.push(clipPath);
    }
    if (!clips.length) {
      const reason = rendered.find((result) => result.status === "rejected");
      throw new Error(`No scene rendered: ${reason?.status === "rejected" ? String(reason.reason) : "unknown"}`);
    }

    onStage("editing");
    const assPath = join(dir, "captions.ass");
    const captioned = payload.captions && words.length > 0;
    if (captioned) await writeFile(assPath, captions(words));
    const total = voiceSeconds + 0.6;
    const scale = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},setsar=1`;
    const filter = [
      ...clips.map((_, index) => `[${index}:v]${scale}[v${index}]`),
      // The last frame holds if the scenes run shorter than the voice.
      `${clips.map((_, index) => `[v${index}]`).join("")}concat=n=${clips.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=30${captioned ? `,subtitles=${assPath}` : ""}[out]`,
    ].join(";");
    const outPath = join(dir, "ad.mp4");
    await execFileAsync(
      ffmpeg(),
      [
        "-y",
        ...clips.flatMap((clip) => ["-i", clip]),
        "-i", voicePath,
        "-filter_complex", filter,
        "-map", "[out]",
        "-map", `${clips.length}:a`,
        "-t", total.toFixed(2),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        outPath,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const stored = await uploadObjectToStorage(appEnv, {
      key: `agent-prototype/videos/${crypto.randomUUID()}.mp4`,
      body: new Uint8Array(await readFile(outPath)),
      contentType: "video/mp4",
    });
    onStage("done");
    return { videoUrl: stored.publicUrl, seconds: Math.round(total), scenes: clips.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Gives a finished video a different voice without touching the picture.
 * ElevenLabs' voice changer keeps the original timing and delivery, so a
 * talking head stays in sync with its lips. Background music under the
 * speech is removed with the old voice.
 */
export async function revoiceVideo(input: {
  videoUrl: string;
  voiceId: string;
  /** Used instead when the person on screen is not the first voice's gender. */
  alternate?: { voiceId: string; gender: "man" | "woman" };
}): Promise<{ videoUrl: string; usedAlternate: boolean }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
  const dir = await mkdtemp(join(tmpdir(), "agent-revoice-"));
  try {
    const sourcePath = join(dir, "source.mp4");
    const source = await fetch(input.videoUrl);
    if (!source.ok) throw new Error(`Could not download the video (${source.status})`);
    await writeFile(sourcePath, new Uint8Array(await source.arrayBuffer()));

    // The recipe casts its own creator. If it cast the other gender than the
    // chosen voice, use the alternate voice so face and voice agree.
    let voiceId = input.voiceId;
    let usedAlternate = false;
    if (input.alternate) {
      const seen = await speakerGender(sourcePath, dir);
      if (seen === input.alternate.gender) {
        voiceId = input.alternate.voiceId;
        usedAlternate = true;
      }
    }

    const speechPath = join(dir, "speech.mp3");
    await execFileAsync(ffmpeg(), ["-y", "-i", sourcePath, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", speechPath]);

    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(await readFile(speechPath))], { type: "audio/mpeg" }), "speech.mp3");
    form.append("model_id", "eleven_multilingual_sts_v2");
    form.append("remove_background_noise", "true");
    const response = await fetch(
      `https://api.elevenlabs.io/v1/voice-changer/${voiceId}?output_format=mp3_44100_128`,
      { method: "POST", headers: { "xi-api-key": apiKey }, body: form },
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs refused the voice change (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    const voicePath = join(dir, "voice.mp3");
    await writeFile(voicePath, new Uint8Array(await response.arrayBuffer()));

    const outPath = join(dir, "ad.mp4");
    await execFileAsync(ffmpeg(), [
      "-y", "-i", sourcePath, "-i", voicePath,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      outPath,
    ]);
    const stored = await uploadObjectToStorage(appEnv, {
      key: `agent-prototype/videos/${crypto.randomUUID()}.mp4`,
      body: new Uint8Array(await readFile(outPath)),
      contentType: "video/mp4",
    });
    return { videoUrl: stored.publicUrl, usedAlternate };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether the person speaking on screen reads as a man or a woman; null when unsure. */
async function speakerGender(videoPath: string, dir: string): Promise<"man" | "woman" | null> {
  const apiKey = process.env.GEMINI_LOCALADS_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const framePath = join(dir, "speaker.jpg");
    await execFileAsync(ffmpeg(), ["-y", "-v", "error", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-vf", "scale=480:-2", framePath]);
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: "This is a frame from a video ad. Is the person speaking to the camera a man or a woman? Answer with one word: man, woman, or none if no person is visible." },
                { inline_data: { mime_type: "image/jpeg", data: (await readFile(framePath)).toString("base64") } },
              ],
            },
          ],
        }),
      },
    );
    if (!response.ok) return null;
    const result = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const answer = (result.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").toLowerCase();
    if (/\bwoman\b/.test(answer)) return "woman";
    if (/\bman\b/.test(answer)) return "man";
    return null;
  } catch {
    return null;
  }
}
