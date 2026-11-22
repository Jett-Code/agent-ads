import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Badge, Card, Orb, Text, tokens, usePal } from "../halaska-kit";

/** The AI SDK's tool part, narrowed to what the cards read. */
export interface ToolPart<Input = unknown, Output = unknown> {
  type: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: Input;
  output?: Output;
  errorText?: string;
}

interface StepCardProps {
  title: string;
  /** Still working: shows the orb instead of the tick. */
  running?: boolean;
  /** Waiting on the person. */
  waiting?: boolean;
  failed?: boolean;
  meta?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

/** One box in the run: a quiet header line, then whatever the step shows. */
export function StepCard({ title, running, waiting, failed, meta, children, style }: StepCardProps) {
  const pal = usePal();
  return (
    <Card padding={16} style={{ minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22 }}>
        {running ? (
          <Orb variant="orbit" size={16} />
        ) : (
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              background: failed ? pal.dangerBg : waiting ? pal.accentBg : pal.successBg,
              color: failed ? pal.danger : waiting ? pal.accent : pal.success,
            }}
          >
            {failed ? "!" : waiting ? "?" : "✓"}
          </span>
        )}
        <Text size="sm" weight="medium">
          {title}
        </Text>
        <span style={{ flex: 1 }} />
        {waiting ? <Badge variant="accent">Your call</Badge> : meta}
      </div>
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </Card>
  );
}

/** A grey block that shimmers while its content is on the way. */
export function Shimmer({ style }: { style?: CSSProperties }) {
  const pal = usePal();
  return (
    <div
      style={{
        borderRadius: tokens.radius.sm,
        background: `linear-gradient(100deg, ${pal.bgMuted} 30%, ${pal.bgSubtle} 50%, ${pal.bgMuted} 70%)`,
        backgroundSize: "200% 100%",
        animation: "agent-shimmer 1.4s linear infinite",
        ...style,
      }}
    />
  );
}

/**
 * Counts down while a review card waits, then fires once: the run carries on
 * with the recommendation if nobody steps in. Touching the card cancels it.
 */
export function useAutoContinue(active: boolean, seconds: number, onFire: () => void) {
  const [left, setLeft] = useState(seconds);
  const [cancelled, setCancelled] = useState(false);
  const fire = useRef(onFire);
  fire.current = onFire;

  useEffect(() => {
    if (!active || cancelled) return;
    if (left <= 0) {
      fire.current();
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [active, cancelled, left]);

  return { left, counting: active && !cancelled && left > 0, cancel: () => setCancelled(true) };
}

export function Thumb({ src, size = 40, ratio = 1 }: { src: string | null | undefined; size?: number; ratio?: number }) {
  const pal = usePal();
  return (
    <div
      style={{
        width: size,
        height: size * ratio,
        flex: "none",
        borderRadius: tokens.radius.sm,
        overflow: "hidden",
        background: pal.bgMuted,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : null}
    </div>
  );
}
