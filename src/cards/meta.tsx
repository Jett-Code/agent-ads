import { useState, type ReactNode } from "react";
import { Badge, Button, Text, tokens, usePal } from "../halaska-kit";
import type { LaunchedAd, LaunchResult, StaticCreative } from "../shared/types";
import { StepCard, Thumb, type ToolPart } from "./shell";

const CTA_LABEL: Record<string, string> = {
  SHOP_NOW: "Shop now",
  LEARN_MORE: "Learn more",
  ORDER_NOW: "Order now",
  GET_OFFER: "Get offer",
};

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);

/** Meta's delivery status in plain words. Everything here is created paused. */
function Delivery({ status }: { status: string }) {
  const pal = usePal();
  const paused = status.includes("PAUSED");
  // Meta reports a new object as "in process" for a few seconds while it sets it up.
  const label = paused ? "Paused" : status === "ACTIVE" ? "Active" : status === "IN_PROCESS" ? "Created" : status.replaceAll("_", " ").toLowerCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: paused ? pal.textMuted : pal.success }} />
      <Text size="xs" secondary>
        {label}
      </Text>
    </span>
  );
}

interface RowProps {
  level: 0 | 1 | 2;
  kind: string;
  name: string;
  status: string;
  left?: ReactNode;
  right?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

/** One line of the campaign tree, indented like Ads Manager's three levels. */
function Row({ level, kind, name, status, left, right, selected, onClick }: RowProps) {
  const pal = usePal();
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        paddingLeft: 10 + level * 20,
        borderRadius: tokens.radius.sm,
        cursor: onClick ? "pointer" : "default",
        background: selected ? pal.bgSubtle : "transparent",
        animation: "agent-rise 0.4s ease both",
        animationDelay: `${level * 80}ms`,
      }}
    >
      {left}
      <div style={{ minWidth: 0, flex: 1 }}>
        <Text size="xs" muted as="div" style={{ textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10 }}>
          {kind}
        </Text>
        <Text size="sm" weight={level === 2 ? "regular" : "medium"} as="div" truncate>
          {name}
        </Text>
      </div>
      {right}
      <Delivery status={status} />
    </div>
  );
}

interface AdPreviewProps {
  pageName: string;
  imageUrl: string | null | undefined;
  copy: NonNullable<LaunchResult["copy"]>;
}

/** The ad as it will look in the Facebook feed. */
function AdPreview({ pageName, imageUrl, copy }: AdPreviewProps) {
  const pal = usePal();
  let host = copy.destinationUrl;
  try {
    host = new URL(copy.destinationUrl).hostname.replace(/^www\./, "");
  } catch {
    // Keep the raw text if it is not a full URL.
  }
  return (
    <div style={{ border: `1px solid ${pal.border}`, borderRadius: tokens.radius.sm, overflow: "hidden", background: pal.bgElevated }}>
      <div style={{ padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: pal.bgMuted,
            display: "grid",
            placeItems: "center",
            fontFamily: tokens.font.sans,
            fontSize: 12,
            color: pal.textSecondary,
          }}
        >
          {pageName.trim().charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" weight="medium" as="div" truncate>
            {pageName}
          </Text>
          <Text size="xs" muted as="div" style={{ fontSize: 10 }}>
            Sponsored
          </Text>
        </div>
      </div>
      <div style={{ padding: "0 10px 8px" }}>
        <Text
          size="xs"
          as="div"
          style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {copy.primaryText}
        </Text>
      </div>
      {imageUrl ? (
        <img src={imageUrl} alt="Ad creative" style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", display: "block" }} />
      ) : null}
      <div style={{ padding: 10, display: "flex", alignItems: "center", gap: 8, background: pal.bgSubtle }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text size="xs" muted as="div" truncate style={{ fontSize: 10, textTransform: "uppercase" }}>
            {host}
          </Text>
          <Text size="xs" weight="medium" as="div" truncate>
            {copy.headline}
          </Text>
        </div>
        <span
          style={{
            flex: "none",
            padding: "6px 10px",
            borderRadius: 6,
            background: pal.bgMuted,
            fontFamily: tokens.font.sans,
            fontSize: 11,
            fontWeight: 600,
            color: pal.text,
          }}
        >
          {CTA_LABEL[copy.cta] ?? copy.cta}
        </span>
      </div>
    </div>
  );
}

interface MetaCardProps {
  part: ToolPart<unknown, LaunchResult>;
  creatives: StaticCreative[];
}

/**
 * What the agent created in Meta Ads: the campaign, its ad sets and ads, with
 * the delivery status Meta reports, and the selected ad as a feed preview.
 */
export function MetaCard({ part, creatives }: MetaCardProps) {
  const pal = usePal();
  const output = part.output;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!output) return <StepCard title="Creating the campaign in Meta Ads" running />;
  if (output.status !== "launched" || !output.campaign) {
    return (
      <StepCard title="Meta Ads" failed meta={<Badge variant="warning">Not launched</Badge>}>
        <Text size="sm" secondary>
          {output.message}
        </Text>
      </StepCard>
    );
  }

  const imageOf = new Map(creatives.map((creative) => [creative.id, creative.imageUrl]));
  const ads: LaunchedAd[] = (output.adSets ?? []).flatMap((adSet) => adSet.ads);
  const selected = ads.find((ad) => ad.id === selectedId) ?? ads[0];
  const { campaign } = output;

  return (
    <StepCard title="Meta Ads" meta={<Badge variant="success">Created, paused</Badge>}>
      <div className="agent-pair" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <Row
            level={0}
            kind="Campaign"
            name={campaign.name}
            status={campaign.status}
            right={
              <Text size="xs" secondary mono style={{ flex: "none" }}>
                {money(campaign.dailyBudget, campaign.currency)}/day
              </Text>
            }
          />
          {(output.adSets ?? []).map((adSet) => (
            <div key={adSet.id} style={{ display: "grid", gap: 2 }}>
              <Row
                level={1}
                kind="Ad set"
                name={adSet.name}
                status={adSet.status}
                right={
                  <Text size="xs" muted mono style={{ flex: "none" }}>
                    {adSet.ads.length} {adSet.ads.length === 1 ? "ad" : "ads"}
                  </Text>
                }
              />
              {adSet.ads.map((ad) => (
                <Row
                  key={ad.id}
                  level={2}
                  kind="Ad"
                  name={ad.name}
                  status={ad.status}
                  left={<Thumb src={imageOf.get(ad.creativeId)} size={28} ratio={1.25} />}
                  selected={ad.id === selected?.id}
                  onClick={() => setSelectedId(ad.id)}
                />
              ))}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, paddingLeft: 10 }}>
            {output.managerUrl ? (
              <Button size="sm" variant="secondary" onClick={() => window.open(output.managerUrl, "_blank", "noopener")}>
                Open in Ads Manager
              </Button>
            ) : null}
            <Text size="xs" secondary truncate>
              {output.accountName} · {campaign.objective}
            </Text>
          </div>
          <Text size="xs" muted mono as="div" style={{ paddingLeft: 10, marginTop: 6, color: pal.textMuted }}>
            Campaign ID {campaign.id}
          </Text>
        </div>
        {selected && output.copy ? (
          <AdPreview
            pageName={output.pageName ?? output.accountName ?? "Page"}
            imageUrl={imageOf.get(selected.creativeId)}
            copy={output.copy}
          />
        ) : null}
      </div>
    </StepCard>
  );
}
