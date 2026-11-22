/** The four ElevenLabs voices the person picks from, all natural Indian-English speakers. */
export const VOICES = {
  tara: { id: "P7vsEyTOpZ6YUTulin8m", name: "Tara", gender: "woman", blurb: "Young woman, expressive, chatty", counterpart: "viraj" },
  monika: { id: "2zRM7PkgwBPiau2jvVXc", name: "Monika", gender: "woman", blurb: "Young woman, deep, natural", counterpart: "raju" },
  viraj: { id: "bajNon13EdhNMndG3z05", name: "Viraj", gender: "man", blurb: "Young man, energetic, made for ads", counterpart: "tara" },
  raju: { id: "pzxut4zZz4GImZNlqQ3H", name: "Raju", gender: "man", blurb: "Young man, relaxed, conversational", counterpart: "monika" },
} as const;

export type VoiceKey = keyof typeof VOICES;
export const VOICE_KEYS = Object.keys(VOICES) as [VoiceKey, ...VoiceKey[]];
