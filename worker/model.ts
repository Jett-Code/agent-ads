import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { Env } from "./env";

const CLAUDE = "claude-sonnet-5-5";
const GEMINI = "gemini-3.8-flash";

/** Claude runs the agent when an Anthropic key is set; Gemini stands in until then. */
export function agentModel(env: Env): LanguageModel {
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(env.AGENT_MODEL ?? CLAUDE);
  }
  return google(env)(env.AGENT_MODEL ?? GEMINI);
}

export const google = (env: Env) => createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });

/** Web research always goes through Gemini, for its Google Search grounding. */
export const SEARCH_MODEL = GEMINI;
