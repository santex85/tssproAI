/**
 * API locale state. Kept in a separate module to avoid circular dependency
 * between api/client and i18n/context.
 */

const SUPPORTED_API_LOCALES = ["ru", "en", "de", "fr", "es", "it", "pt", "th"] as const;

let apiLocale = "en";

export function setApiLocale(locale: string): void {
  apiLocale = SUPPORTED_API_LOCALES.includes(locale as (typeof SUPPORTED_API_LOCALES)[number])
    ? locale
    : "en";
}

export function getApiLocale(): string {
  return apiLocale;
}
