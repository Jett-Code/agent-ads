import { Badge, Text, tokens, usePal } from "../halaska-kit";
import type { CompetitorResult, MarketResult, ProductResult } from "../shared/types";
import { Shimmer, StepCard, Thumb, type ToolPart } from "./shell";

export function ProductCard({ part }: { part: ToolPart<unknown, ProductResult> }) {
  const output = part.output;
  const product = output?.product;
  if (!product) {
    const failed = output?.stage === "failed" || part.state === "output-error";
    return (
      <StepCard title={failed ? "Product not found" : "Finding the product"} running={!failed} failed={failed}>
        {failed ? (
          <Text size="sm" secondary>
            {output?.message ?? part.errorText}
          </Text>
        ) : null}
      </StepCard>
    );
  }
  return (
    <StepCard title="Product" meta={<Badge>{product.brandName}</Badge>}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Thumb src={product.imageUrl} size={48} />
        <Text size="sm" weight="medium" truncate>
          {product.name}
        </Text>
      </div>
    </StepCard>
  );
}

export function CompetitorCard({ part }: { part: ToolPart<unknown, CompetitorResult> }) {
  const pal = usePal();
  const output = part.output;
  const running = !output || output.stage === "scanning";
  const failed = output?.stage === "failed" || part.state === "output-error";
  return (
    <StepCard
      title="Competitor ads"
      running={running && !failed}
      failed={failed}
      meta={output?.stage === "done" ? <Badge>{output.scanned} scanned</Badge> : null}
    >
      {failed ? (
        <Text size="sm" secondary>
          {output?.message ?? part.errorText}
        </Text>
      ) : (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {running
            ? [0, 1, 2, 3, 4].map((index) => <Shimmer key={index} style={{ width: 96, height: 128, flex: "none" }} />)
            : output.ads.map((ad) => (
                <a
                  key={ad.id}
                  href={ad.libraryUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  title={ad.body}
                  style={{ width: 96, flex: "none", textDecoration: "none", animation: "agent-rise 0.4s ease both" }}
                >
                  <div style={{ position: "relative" }}>
                    <Thumb src={ad.imageUrl} size={96} ratio={4 / 3} />
                    <span
                      style={{
                        position: "absolute",
                        left: 6,
                        bottom: 6,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "rgba(0,0,0,0.72)",
                        color: "#fff",
                        fontFamily: tokens.font.mono,
                        fontSize: 10,
                      }}
                    >
                      {ad.daysRunning}d
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: tokens.font.sans,
                      fontSize: 11,
                      color: pal.textSecondary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {ad.page}
                  </div>
                </a>
              ))}
        </div>
      )}
    </StepCard>
  );
}

export function MarketCard({ part }: { part: ToolPart<unknown, MarketResult> }) {
  const output = part.output;
  const running = !output || output.stage === "searching";
  const failed = output?.stage === "failed" || part.state === "output-error";
  return (
    <StepCard
      title="Market and season"
      running={running && !failed}
      failed={failed}
      meta={output?.season ? <Badge variant="accent">{output.season.moment}</Badge> : null}
    >
      {failed ? (
        <Text size="sm" secondary>
          {output?.message ?? part.errorText}
        </Text>
      ) : running ? (
        <div style={{ display: "grid", gap: 10 }}>
          {[80, 64, 72].map((width) => (
            <Shimmer key={width} style={{ height: 14, width: `${width}%` }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {output.trends.map((trend) => (
            <div key={trend.title} style={{ animation: "agent-rise 0.4s ease both" }}>
              <Text size="sm" weight="medium" as="div">
                {trend.title}
              </Text>
              <Text size="xs" secondary as="div">
                {trend.why}
              </Text>
            </div>
          ))}
        </div>
      )}
    </StepCard>
  );
}
