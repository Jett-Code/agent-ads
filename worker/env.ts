export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GEMINI_API_KEY: string;
  /** Optional. When set, Claude runs the agent instead of Gemini. */
  ANTHROPIC_API_KEY?: string;
  LOCALADS_API_KEY: string;
  LOCALADS_API_URL: string;
  APIFY_TOKEN: string;
  /** Only used to play voice previews; speech is made by the render service. */
  ELEVENLABS_API_KEY: string;
  /** The voiceover video render service (apps/agent/render-server.ts). */
  RENDER_URL?: string;
  /** Meta launch goes through Treg. Without the key the launch step reports "not connected". */
  TREG_API_KEY?: string;
  /** Optional pins; otherwise the first Meta connection, ad account and page are used. */
  META_CONNECTION?: string;
  META_AD_ACCOUNT_ID?: string;
  META_PAGE_ID?: string;
  /** Optional model id override for the agent's provider. */
  AGENT_MODEL?: string;
}
