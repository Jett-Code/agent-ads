/** Shapes the worker's tools return and the cards render. */

export interface ProductResult {
  ok: boolean;
  stage: "searching" | "reading" | "ready" | "failed";
  message?: string;
  product?: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    brandName: string;
    sourceUrl: string | null;
  };
}

export interface CompetitorAdView {
  id: string;
  page: string;
  format: string;
  daysRunning: number;
  variants: number;
  body: string;
  cta: string | null;
  imageUrl: string | null;
  libraryUrl: string | null;
}

export interface CompetitorResult {
  ok: boolean;
  stage: "scanning" | "done" | "failed";
  keywords: string[];
  scanned: number;
  ads: CompetitorAdView[];
  message?: string;
}

export interface MarketResult {
  ok: boolean;
  stage: "searching" | "done" | "failed";
  trends: { title: string; why: string }[];
  season: { moment: string; when: string; insight: string } | null;
  hooks: string[];
  sources: string[];
  message?: string;
}

export interface StaticCreative {
  id: string;
  imageUrl: string | null;
  status: string;
  score?: number;
  note?: string;
}

export interface StaticsResult {
  ok: boolean;
  stage: "starting" | "rendering" | "scoring" | "done" | "failed";
  campaignId?: string;
  total: number;
  creatives: StaticCreative[];
  creditsCharged?: number;
  message?: string;
}

export interface VideoResult {
  ok: boolean;
  jobId?: string;
  script: string;
  voiceName?: string;
  format?: string;
  message?: string;
}

export interface VoiceInput {
  recommended: string;
  reason: string;
}

export interface VideoStatus {
  /** voice, scenes, editing, filming, revoicing, done, or failed. */
  stage: string;
  videoUrl: string | null;
  /** Set when the voice was switched to match the person on screen. */
  voiceName?: string;
  message?: string;
}

export interface Angle {
  id: string;
  title: string;
  hook: string;
  why: string;
  format: "static" | "video" | "both";
  score: number;
}

export interface AnglesInput {
  angles: Angle[];
  recommended: string[];
}

export interface PickInput {
  recommended: string[];
  reason: string;
}

export interface PlanInput {
  platform: "meta";
  campaign: { name: string; objective: string; dailyBudget: number; currency: string };
  adSets: { name: string; audience: string; placements: string; creativeIds: string[] }[];
  primaryText: string;
  headline: string;
  cta: string;
  destinationUrl: string;
  why: string;
}

export interface LaunchedAd {
  id: string;
  name: string;
  status: string;
  creativeId: string;
}

export interface LaunchedAdSet {
  id: string;
  name: string;
  status: string;
  ads: LaunchedAd[];
}

export interface LaunchResult {
  ok: boolean;
  status: "launched" | "not_connected" | "failed";
  message: string;
  accountName?: string;
  pageName?: string;
  campaign?: { id: string; name: string; status: string; dailyBudget: number; currency: string; objective: string };
  adSets?: LaunchedAdSet[];
  adsCreated?: number;
  /** The copy every ad carries, for the preview. */
  copy?: { primaryText: string; headline: string; cta: string; destinationUrl: string };
  managerUrl?: string;
}
