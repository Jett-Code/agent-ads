import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { StaticsCard, VideoCard } from "./cards/creatives";
import { AnglesGate, PickGate, PlanGate, VoiceGate } from "./cards/gates";
import { MetaCard } from "./cards/meta";
import { CompetitorCard, MarketCard, ProductCard } from "./cards/research";
import type { ToolPart } from "./cards/shell";
import { ChatInput, Heading, Text, ThinkingIndicator, tokens, usePal } from "./halaska-kit";
import type { StaticCreative, StaticsResult } from "./shared/types";

const STAGES = [
  { label: "Research", tools: ["find_product", "scan_competitor_ads", "research_market"] },
  { label: "Angles", tools: ["choose_angles", "choose_voice"] },
  { label: "Creatives", tools: ["make_statics", "make_video", "pick_creatives"] },
  { label: "Plan", tools: ["approve_plan"] },
  { label: "Launch", tools: ["launch_meta"] },
];

/** Tools that render side by side when the agent calls them in the same step. */
const PAIRS: Record<string, string> = { scan_competitor_ads: "1fr 1fr", research_market: "1fr 1fr", make_statics: "2fr 1fr", make_video: "2fr 1fr" };

const SUGGESTIONS = [
  "Create this week's Black Friday ads for Avvatar Malai Kulfi whey protein",
  "Launch festive ads for my best seller",
];

type AnyPart = { type: string; text?: string } & Partial<ToolPart>;
const toolName = (part: AnyPart) => (part.type.startsWith("tool-") ? part.type.slice(5) : null);

function StageRail({ reached }: { reached: number }) {
  const pal = usePal();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {STAGES.map((stage, index) => (
        <div key={stage.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: index <= reached ? pal.accent : pal.border,
              transition: "background 0.3s ease",
            }}
          />
          <Text size="xs" weight={index === reached ? "medium" : "regular"} muted={index > reached}>
            {stage.label}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const pal = usePal();
  const { messages, sendMessage, status, stop, error, addToolOutput } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // A review card's answer sends itself, so the run never waits for a prompt.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const busy = status === "submitted" || status === "streaming";
  const parts = useMemo(() => {
    const all = messages.filter((message) => message.role === "assistant").flatMap((message) => message.parts as AnyPart[]);
    // A failed step the agent then retried is noise: keep only the retry.
    return all.filter(
      (part, index) =>
        !(part.state === "output-error" && all.slice(index + 1).some((later) => later.type === part.type)),
    );
  }, [messages]);

  const creatives: StaticCreative[] = useMemo(() => {
    const statics = parts.filter((part) => toolName(part) === "make_statics").at(-1);
    return ((statics?.output as StaticsResult | undefined)?.creatives ?? []).filter((creative) => creative.imageUrl);
  }, [parts]);

  const reached = STAGES.reduce(
    (latest, stage, index) => (parts.some((part) => stage.tools.includes(toolName(part) ?? "")) ? index : latest),
    -1,
  );

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [parts.length, status]);

  const answer = (part: AnyPart) => (output: unknown) =>
    void addToolOutput({ tool: toolName(part) as never, toolCallId: part.toolCallId as string, output: output as never });

  const renderTool = (part: AnyPart): ReactNode => {
    const tool = part as ToolPart<never, never>;
    switch (toolName(part)) {
      case "find_product":
        return <ProductCard part={tool} />;
      case "scan_competitor_ads":
        return <CompetitorCard part={tool} />;
      case "research_market":
        return <MarketCard part={tool} />;
      case "choose_angles":
        return <AnglesGate part={tool} onDone={answer(part)} />;
      case "choose_voice":
        return <VoiceGate part={tool} onDone={answer(part)} />;
      case "make_statics":
        return <StaticsCard part={tool} />;
      case "make_video":
        return <VideoCard part={tool} />;
      case "pick_creatives":
        return <PickGate part={tool} onDone={answer(part)} creatives={creatives} />;
      case "approve_plan":
        return <PlanGate part={tool} onDone={answer(part)} creatives={creatives} />;
      case "launch_meta":
        return <MetaCard part={tool} creatives={creatives} />;
      default:
        return null;
    }
  };

  // Walk the parts in order, putting paired tools on one row.
  const rows: ReactNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const name = toolName(part);
    if (!name) {
      if (part.type === "text" && part.text?.trim()) {
        rows.push(
          <Text key={`text-${index}`} size="sm" secondary as="div" style={{ padding: "0 4px" }}>
            {part.text}
          </Text>,
        );
      }
      continue;
    }
    const next = parts[index + 1];
    const nextName = next ? toolName(next) : null;
    if (PAIRS[name] && nextName && PAIRS[nextName] === PAIRS[name] && nextName !== name) {
      rows.push(
        <div key={part.toolCallId} className="agent-pair" style={{ display: "grid", gridTemplateColumns: PAIRS[name], gap: 12, alignItems: "start" }}>
          {renderTool(part)}
          {renderTool(next)}
        </div>,
      );
      index += 1;
      continue;
    }
    rows.push(<div key={part.toolCallId}>{renderTool(part)}</div>);
  }

  const prompt = messages.find((message) => message.role === "user");
  const promptText = (prompt?.parts as AnyPart[] | undefined)?.find((part) => part.type === "text")?.text;
  const started = Boolean(prompt);
  const waitingOnPerson = parts.some((part) => toolName(part) && part.state === "input-available" && ["choose_angles", "choose_voice", "pick_creatives", "approve_plan"].includes(toolName(part) ?? ""));
  const lastPart = parts.at(-1);
  const thinking = busy && (!lastPart || !toolName(lastPart) || lastPart.state === "output-available");

  return (
    <div style={{ minHeight: "100%", background: pal.bg, color: pal.text, fontFamily: tokens.font.sans }}>
      <style>{`
        @keyframes agent-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes agent-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (max-width: 640px) { .agent-pair { grid-template-columns: 1fr !important; } }
      `}</style>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {started ? (
          <>
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                padding: "16px 0 12px",
                background: pal.bg,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <StageRail reached={reached} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 20px" }}>
              <div style={{ maxWidth: "80%", padding: "10px 16px", borderRadius: tokens.radius.md, background: pal.bgMuted }}>
                <Text size="sm">{promptText}</Text>
              </div>
            </div>
            <div style={{ display: "grid", gap: 12, flex: 1, alignContent: "start", paddingBottom: 120 }}>
              {rows}
              {thinking ? <ThinkingIndicator label="Working" size="sm" /> : null}
              {error ? (
                <Text size="sm" color={pal.danger} as="div">
                  {error.message}
                </Text>
              ) : null}
              {!busy && !waitingOnPerson && !error && reached >= 0 ? (
                <Text size="xs" muted as="div" style={{ padding: "0 4px" }}>
                  Run finished.
                </Text>
              ) : null}
              <div ref={end} />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, paddingBottom: 80 }}>
            <Heading level={2} style={{ textAlign: "center", margin: 0 }}>
              What are we advertising?
            </Heading>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ChatInput
                placeholder="Create this week's ads for..."
                suggestions={SUGGESTIONS}
                models={[]}
                onSubmit={(text: string) => void sendMessage({ text })}
              />
            </div>
          </div>
        )}
        {started && busy ? (
          <div style={{ position: "fixed", bottom: 20, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <button
              type="button"
              onClick={() => void stop()}
              style={{
                pointerEvents: "auto",
                padding: "8px 16px",
                borderRadius: 999,
                border: `1px solid ${pal.border}`,
                background: pal.bgElevated,
                color: pal.textSecondary,
                fontFamily: tokens.font.sans,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Stop
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
