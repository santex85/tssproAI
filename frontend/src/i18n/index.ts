export { I18nProvider, useTranslation } from "./context";
export type { TranslationKey, Locale } from "./translations";

function get(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Translate by key. Uses English as fallback when used outside I18nProvider.
 * Prefer useTranslation() in components so locale changes re-render.
 */
export function t(key: string): string {
  const { messages } = require("./translations");
  return get(messages.en as Record<string, unknown>, key) ?? key;
}
