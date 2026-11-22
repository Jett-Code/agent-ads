import { useEffect, useState } from "react";
import { Badge, Text, tokens, usePal } from "../halaska-kit";
import type { StaticCreative, StaticsResult, VideoResult, VideoStatus } from "../shared/types";
import { Shimmer, StepCard, type ToolPart } from "./shell";

interface TileProps {
  creative?: StaticCreative;
  selected?: boolean;
  onClick?: () => void;
}

export function CreativeTile({ creative, selected, onClick }: TileProps) {
  const pal = usePal();
  if (!creative?.imageUrl) return <Shimmer style={{ aspectRatio: "4 / 5", width: "100%" }} />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        position: "relative",
        padding: 0,
        border: "none",
        background: "none",
        cursor: onClick ? "pointer" : "default",
        borderRadius: tokens.radius.sm,
        overflow: "hidden",
        outline: selected ? `2px solid ${pal.accent}` : `1px solid ${pal.borderSubtle}`,
        outlineOffset: selected ? 2 : 0,
        opacity: selected === false ? 0.55 : 1,
        transition: "opacity 0.2s ease",
        animation: "agent-rise 0.5s ease both",
      }}
    >
      <img
        src={creative.imageUrl}
        alt={creative.note ?? "Ad creative"}
        style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", display: "block" }}
      />
      {creative.score !== undefined ? (
        <span
          title={creative.note}
          style={{
            position: "absolute",
            right: 6,
            top: 6,
            padding: "2px 6px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.72)",
            color: "#fff",
            fontFamily: tokens.font.mono,
            fontSize: 10,
          }}
        >
          {creative.score}
        </span>
      ) : null}
    </button>
  );
}

export function StaticsCard({ part }: { part: ToolPart<{ count?: number }, StaticsResult> }) {
  const output = part.output;
  const total = output?.total ?? part.input?.count ?? 6;
  const failed = output?.stage === "failed" || part.state === "output-error";
  const done = output?.stage === "done";
  const ready = output?.creatives.filter((creative) => creative.imageUrl).length ?? 0;
  const slots = Array.from({ length: Math.max(total, output?.creatives.length ?? 0) }, (_, index) => output?.creatives[index]);
  return (
    <StepCard
      title="Static ads"
      running={!done && !failed}
      failed={failed}
      meta={<Badge>{output?.stage === "scoring" ? "Scoring" : `${ready}/${total}`}</Badge>}
    >
      {failed ? (
        <Text size="sm" secondary>
          {output?.message ?? part.errorText}
        </Text>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {(done ? output.creatives : slots).map((creative, index) => (
            <CreativeTile key={creative?.id ?? index} creative={creative} />
          ))}
        </div>
      )}
    </StepCard>
  );
}

const STAGE_LABEL: Record<string, string> = {
  voice: "Recording voice",
  scenes: "Filming scenes",
  editing: "Editing",
  filming: "Filming",
  revoicing: "Changing voice",
  done: "Ready",
};

/** Polls the render until the finished file is there. */
function useVideo(jobId: string | undefined) {
  const [status, setStatus] = useState<VideoStatus | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/video/${jobId}`);
        if (response.ok) {
          const next = (await response.json()) as VideoStatus;
          if (stopped) return;
          setStatus(next);
          if (next.videoUrl || next.stage === "failed") return;
        }
      } catch {
        // A dropped poll is fine; the next one tries again.
      }
      timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);
  return status;
}

export function VideoCard({ part }: { part: ToolPart<{ script?: string }, VideoResult> }) {
  const pal = usePal();
  const output = part.output;
  const status = useVideo(output?.jobId);
  const failed = output?.ok === false || status?.stage === "failed" || part.state === "output-error";
  const ready = Boolean(status?.videoUrl);

  return (
    <StepCard
      title="Video ad"
      running={!ready && !failed}
      failed={failed}
      meta={
        failed ? null : ready && output?.voiceName ? (
          <Badge>Voice: {status?.voiceName ?? output.voiceName}</Badge>
        ) : (
          <Badge>{STAGE_LABEL[status?.stage ?? "voice"] ?? "Working"}</Badge>
        )
      }
    >
      {failed ? (
        <Text size="sm" secondary>
          {output?.message ?? status?.message ?? part.errorText ?? "The video did not render."}
        </Text>
      ) : (
        <div
          style={{
            aspectRatio: "9 / 16",
            borderRadius: tokens.radius.sm,
            overflow: "hidden",
            background: pal.bgMuted,
          }}
        >
          {ready ? (
            <video
              src={status?.videoUrl ?? undefined}
              controls
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <Shimmer style={{ width: "100%", height: "100%", borderRadius: 0 }} />
          )}
        </div>
      )}
    </StepCard>
  );
}
