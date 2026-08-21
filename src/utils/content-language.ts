/**
 * The language a generated artifact comes out in — distinct from the UI locale.
 *
 * These two were the same value until an issue showed why they cannot be
 * (#34): `uiLocale` picks the interface language the DOM selectors are written
 * against, and it was leaking into every generation request, so a Spanish
 * notebook produced French audio and French mind-map nodes while the tool
 * cheerfully reported success.
 *
 * NotebookLM identifies an output language by a BCP-47 code (`es`, `pt_BR`,
 * `zh_Hans`), not by a display name — a name lands in the payload slot, fails
 * to match anything, and the request's `hl` silently decides instead. The
 * catalog below is the accepted set, taken from teng-lin/notebooklm-py (MIT),
 * which derived it from the web app's own `WIZ_global_data`; the values are
 * the native names NotebookLM shows in its language menu, which is what the
 * browser fallback has to click on.
 */

/** Accepted output languages: BCP-47 code → the native name NotebookLM displays. */
export const CONTENT_LANGUAGES: Record<string, string> = {
  en: 'English',
  zh_Hans: '中文（简体）',
  zh_Hant: '中文（繁體）',
  es: 'Español',
  es_419: 'Español (Latinoamérica)',
  es_MX: 'Español (México)',
  hi: 'हिन्दी',
  ar_001: 'العربية',
  ar_eg: 'العربية (مصر)',
  pt_BR: 'Português (Brasil)',
  pt_PT: 'Português (Portugal)',
  bn: 'বাংলা',
  ru: 'Русский',
  ja: '日本語',
  pa: 'ਪੰਜਾਬੀ',
  de: 'Deutsch',
  jv: 'Basa Jawa',
  ko: '한국어',
  fr: 'Français',
  fr_CA: 'Français (Canada)',
  te: 'తెలుగు',
  vi: 'Tiếng Việt',
  mr: 'मराठी',
  ta: 'தமிழ்',
  tr: 'Türkçe',
  ur: 'اردو',
  it: 'Italiano',
  th: 'ไทย',
  gu: 'ગુજરાતી',
  fa: 'فارسی',
  pl: 'Polski',
  uk: 'Українська',
  ml: 'മലയാളം',
  kn: 'ಕನ್ನಡ',
  or: 'ଓଡ଼ିଆ',
  my: 'မြန်မာဘာသာ',
  sw: 'Kiswahili',
  nl_NL: 'Nederlands',
  ro: 'Română',
  hu: 'Magyar',
  el: 'Ελληνικά',
  cs: 'Čeština',
  sv: 'Svenska',
  be: 'Беларуская',
  bg: 'Български',
  hr: 'Hrvatski',
  sk: 'Slovenčina',
  da: 'Dansk',
  fi: 'Suomi',
  nb_NO: 'Norsk Bokmål',
  nn_NO: 'Norsk Nynorsk',
  he: 'עברית',
  iw: 'עברית',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  fil: 'Filipino',
  ceb: 'Cebuano',
  sr: 'Српски',
  sl: 'Slovenščina',
  sq: 'Shqip',
  mk: 'Македонски',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  et: 'Eesti',
  hy: 'Հայերեն',
  ka: 'ქართული',
  az: 'Azərbaycanca',
  af: 'Afrikaans',
  am: 'አማርኛ',
  eu: 'Euskara',
  ca: 'Català',
  gl: 'Galego',
  is: 'Íslenska',
  la: 'Latina',
  ne: 'नेपाली',
  ps: 'پښتو',
  sd: 'سنڌي',
  si: 'සිංහල',
  ht: 'Kreyòl Ayisyen',
  kok: 'कोंकणी',
  mai: 'मैथिली',
};

/** Default output language when neither the caller nor the config names one. */
export const DEFAULT_CONTENT_LANGUAGE = 'en';

/**
 * English names for the catalog, so a caller can say "Spanish" as well as "es".
 *
 * Built from the runtime's own locale data rather than a second hand-kept
 * table. If the runtime was compiled without it, code and native-name lookups
 * still work — only the English aliases go missing.
 */
const ENGLISH_NAME_TO_CODE: Map<string, string> = (() => {
  const map = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    for (const code of Object.keys(CONTENT_LANGUAGES)) {
      const english = names.of(code.replace(/_/g, '-'));
      if (english) map.set(english.toLowerCase(), code);
    }
  } catch {
    /* no locale data — codes and native names still resolve */
  }
  return map;
})();

const NATIVE_NAME_TO_CODE: Map<string, string> = new Map(
  Object.entries(CONTENT_LANGUAGES).map(([code, native]) => [native.toLowerCase(), code])
);

const LOWER_CODE_TO_CODE: Map<string, string> = new Map(
  Object.keys(CONTENT_LANGUAGES).map((code) => [code.toLowerCase(), code])
);

/**
 * Resolve whatever the caller wrote into a code NotebookLM accepts.
 *
 * Takes a code in either separator (`pt_BR`, `pt-BR`), the English name
 * ("Portuguese (Brazil)"), or the native name ("Português (Brasil)").
 * Returns null when nothing matches — the caller must say so rather than
 * generate in some other language and report success, which is the failure
 * this whole module exists to prevent.
 */
export function resolveContentLanguage(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/-/g, '_').toLowerCase();
  return (
    LOWER_CODE_TO_CODE.get(normalized) ??
    ENGLISH_NAME_TO_CODE.get(trimmed.toLowerCase()) ??
    NATIVE_NAME_TO_CODE.get(trimmed.toLowerCase()) ??
    // A bare language with a region we do not list ("es-CO") still means
    // Spanish; fall back to the base language rather than refusing outright.
    LOWER_CODE_TO_CODE.get(normalized.split('_')[0]) ??
    null
  );
}

/**
 * The English name for a code, for prompts written in English.
 *
 * The browser fallback asks NotebookLM in chat to "generate the content in X",
 * so X wants to be a language name a model reads naturally, not a code.
 * Returns undefined when the runtime has no locale data.
 */
export function contentLanguageEnglishName(code: string): string | undefined {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replace(/_/g, '-'));
  } catch {
    return undefined;
  }
}

/** The native name NotebookLM shows for a code — what the browser menu displays. */
export function contentLanguageName(code: string): string | undefined {
  return CONTENT_LANGUAGES[code];
}

/** A short sample of accepted codes, for error messages. */
export function contentLanguageHint(): string {
  return `${Object.keys(CONTENT_LANGUAGES).length} languages accepted, by BCP-47 code (en, es, fr, pt_BR, zh_Hans…) or by name ("Spanish", "Español")`;
}
