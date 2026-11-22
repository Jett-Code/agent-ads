import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, Checkbox, Text, tokens, usePal } from "../halaska-kit";
import type { AnglesInput, PickInput, PlanInput, StaticCreative, VoiceInput } from "../shared/types";
import { VOICES, type VoiceKey } from "../shared/voices";
import { CreativeTile } from "./creatives";
import { StepCard, Thumb, useAutoContinue, type ToolPart } from "./shell";

const AUTO_SECONDS = 30;

interface GateFooterProps {
  label: string;
  onConfirm: () => void;
  left: number;
  counting: boolean;
  disabled?: boolean;
  secondary?: ReactNode;
}

function GateFooter({ label, onConfirm, left, counting, disabled, secondary }: GateFooterProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
      <Button size="sm" onClick={onConfirm} disabled={disabled}>
        {label}
      </Button>
      {secondary}
      <span style={{ flex: 1 }} />
      {counting ? (
        <Text size="xs" muted mono>
          auto in {left}s
        </Text>
      ) : null}
    </div>
  );
}

const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

interface GateProps<Input> {
  part: ToolPart<Input, unknown>;
  onDone: (output: unknown) => void;
}

export function AnglesGate({ part, onDone }: GateProps<AnglesInput>) {
  const pal = usePal();
  const input = part.input;
  const waiting = part.state === "input-available";
  const answered = part.state === "output-available";
  const chosen = (part.output as { selected?: string[] } | undefined)?.selected;
  const [selected, setSelected] = useState<string[] | null>(null);
  const current = chosen ?? selected ?? input?.recommended ?? [];
  const confirm = () => onDone({ selected: current });
  const auto = useAutoContinue(waiting, AUTO_SECONDS, confirm);

  if (!input?.angles?.length) return <StepCard title="Shaping angles" running />;
  return (
    <StepCard
      title="Creative angles"
      waiting={waiting}
      running={part.state === "input-streaming"}
      meta={answered ? <Badge>{current.length} chosen</Badge> : null}
    >
      <div onPointerDown={auto.cancel} style={{ display: "grid", gap: 2 }}>
        {input.angles.map((angle) => {
          if (!angle?.id) return null;
          const on = current.includes(angle.id);
          if (answered && !on) return null;
          return (
            <div
              key={angle.id}
              onClick={waiting ? () => setSelected(toggleIn(current, angle.id)) : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 8px",
                borderRadius: tokens.radius.sm,
                cursor: waiting ? "pointer" : "default",
                background: on && waiting ? pal.bgSubtle : "transparent",
              }}
            >
              {waiting ? <Checkbox checked={on} onChange={() => undefined} aria-label={angle.title} /> : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Text size="sm" weight="medium">
                    {angle.title}
                  </Text>
                  {input.recommended?.includes(angle.id) ? <Badge variant="accent">Recommended</Badge> : null}
                </div>
                <Text size="xs" secondary as="div" truncate title={angle.why}>
                  {angle.hook}
                </Text>
              </div>
              <Text size="xs" muted mono>
                {angle.score}
              </Text>
            </div>
          );
        })}
      </div>
      {waiting ? (
        <GateFooter
          label={`Continue with ${current.length}`}
          onConfirm={confirm}
          left={auto.left}
          counting={auto.counting}
          disabled={current.length === 0}
        />
      ) : null}
    </StepCard>
  );
}

export function VoiceGate({ part, onDone }: GateProps<VoiceInput>) {
  const pal = usePal();
  const input = part.input;
  const waiting = part.state === "input-available";
  const answered = part.state === "output-available";
  const chosen = (part.output as { voice?: string } | undefined)?.voice;
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = (chosen ?? selected ?? input?.recommended ?? "tara") as VoiceKey;
  const confirm = () => {
    audio.current?.pause();
    onDone({ voice: current });
  };
  const auto = useAutoContinue(waiting, AUTO_SECONDS, confirm);

  const play = (key: string) => {
    audio.current?.pause();
    if (playing === key) {
      setPlaying(null);
      return;
    }
    const clip = new Audio(`/api/voice-preview/${key}`);
    clip.onended = () => setPlaying(null);
    audio.current = clip;
    setPlaying(key);
    void clip.play();
  };

  if (answered) {
    return <StepCard title="Voice" meta={<Badge>{VOICES[current]?.name ?? current}</Badge>} />;
  }
  return (
    <StepCard title="Pick a voice" waiting={waiting} running={part.state === "input-streaming"}>
      <div onPointerDown={auto.cancel} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {(Object.keys(VOICES) as VoiceKey[]).map((key) => {
          const on = key === current;
          return (
            <div
              key={key}
              onClick={waiting ? () => setSelected(key) : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 10,
                borderRadius: tokens.radius.sm,
                cursor: waiting ? "pointer" : "default",
                border: `1px solid ${on ? pal.accent : pal.borderSubtle}`,
                background: on ? pal.bgSubtle : "transparent",
              }}
            >
              <button
                type="button"
                aria-label={`Play ${VOICES[key].name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  play(key);
                }}
                style={{
                  width: 30,
                  height: 30,
                  flex: "none",
                  borderRadius: 999,
                  border: `1px solid ${pal.border}`,
                  background: pal.bgElevated,
                  color: pal.text,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {playing === key ? "❚❚" : "▶"}
              </button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Text size="sm" weight="medium">
                    {VOICES[key].name}
                  </Text>
                  {input?.recommended === key ? <Badge variant="accent">Recommended</Badge> : null}
                </div>
                <Text size="xs" secondary as="div" truncate>
                  {VOICES[key].blurb}
                </Text>
              </div>
            </div>
          );
        })}
      </div>
      {waiting ? (
        <GateFooter label={`Use ${VOICES[current]?.name ?? "voice"}`} onConfirm={confirm} left={auto.left} counting={auto.counting} />
      ) : null}
    </StepCard>
  );
}

interface PickGateProps extends GateProps<PickInput> {
  creatives: StaticCreative[];
}

export function PickGate({ part, onDone, creatives }: PickGateProps) {
  const input = part.input;
  const waiting = part.state === "input-available";
  const answered = part.state === "output-available";
  const chosen = (part.output as { selected?: string[] } | undefined)?.selected;
  const [selected, setSelected] = useState<string[] | null>(null);
  const known = new Set(creatives.map((creative) => creative.id));
  const current = (chosen ?? selected ?? input?.recommended ?? []).filter((id) => known.has(id));
  const confirm = () => onDone({ selected: current });
  const auto = useAutoContinue(waiting && current.length > 0, AUTO_SECONDS, confirm);
  const shown = answered ? creatives.filter((creative) => current.includes(creative.id)) : creatives;

  return (
    <StepCard
      title="Pick the ads to run"
      waiting={waiting}
      running={part.state === "input-streaming"}
      meta={answered ? <Badge>{current.length} chosen</Badge> : null}
    >
      <div
        onPointerDown={auto.cancel}
        style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, padding: 2 }}
      >
        {shown.map((creative) => (
          <CreativeTile
            key={creative.id}
            creative={creative}
            selected={waiting ? current.includes(creative.id) : undefined}
            onClick={waiting ? () => setSelected(toggleIn(current, creative.id)) : undefined}
          />
        ))}
      </div>
      {waiting ? (
        <GateFooter
          label={`Use these ${current.length}`}
          onConfirm={confirm}
          left={auto.left}
          counting={auto.counting}
          disabled={current.length === 0}
          secondary={
            <Text size="xs" secondary>
              {input?.reason}
            </Text>
          }
        />
      ) : null}
    </StepCard>
  );
}

interface PlanGateProps extends GateProps<PlanInput> {
  creatives: StaticCreative[];
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);

export function PlanGate({ part, onDone, creatives }: PlanGateProps) {
  const pal = usePal();
  const input = part.input;
  const waiting = part.state === "input-available";
  const answered = part.state === "output-available";
  const approved = (part.output as { approved?: boolean } | undefined)?.approved;
  const confirm = () => onDone({ approved: true });
  const auto = useAutoContinue(waiting, AUTO_SECONDS, confirm);
  const byId = new Map(creatives.map((creative) => [creative.id, creative]));

  if (!input?.campaign?.name) return <StepCard title="Planning the campaign" running />;
  return (
    <StepCard
      title="Meta campaign"
      waiting={waiting}
      running={part.state === "input-streaming"}
      failed={answered && approved === false}
      meta={answered ? <Badge variant={approved ? "success" : "default"}>{approved ? "Approved" : "Held"}</Badge> : null}
    >
      <div onPointerDown={auto.cancel} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size="sm" weight="medium" truncate>
            {input.campaign.name}
          </Text>
          <span style={{ flex: 1 }} />
          <Badge>{input.campaign.objective === "OUTCOME_SALES" ? "Sales" : "Traffic"}</Badge>
          <Badge variant="accent">{money(input.campaign.dailyBudget, input.campaign.currency)}/day</Badge>
        </div>
        <div style={{ display: "grid", gap: 8, paddingLeft: 12, borderLeft: `1px solid ${pal.border}` }}>
          {(input.adSets ?? []).map((adSet, index) => (
            <div key={`${index}-${adSet.name}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" weight="medium" as="div">
                  {adSet.name}
                </Text>
                <Text size="xs" secondary as="div" truncate>
                  {adSet.audience} · {adSet.placements}
                </Text>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {(adSet.creativeIds ?? []).map((id, thumb) => (
                  <Thumb key={`${thumb}-${id}`} src={byId.get(id)?.imageUrl} size={32} ratio={1.25} />
                ))}
              </div>
            </div>
          ))}
        </div>
        {input.headline ? (
          <div style={{ padding: 12, borderRadius: tokens.radius.sm, background: pal.bgSubtle }}>
            <Text size="sm" weight="medium" as="div">
              {input.headline}
            </Text>
            <Text size="xs" secondary as="div">
              {input.primaryText}
            </Text>
          </div>
        ) : null}
      </div>
      {waiting ? (
        <GateFooter
          label="Launch paused"
          onConfirm={confirm}
          left={auto.left}
          counting={auto.counting}
          secondary={
            <Button size="sm" variant="ghost" onClick={() => onDone({ approved: false })}>
              Hold
            </Button>
          }
        />
      ) : null}
    </StepCard>
  );
}
