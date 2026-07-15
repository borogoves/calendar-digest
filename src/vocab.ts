// The locale-driven half of internationalization: list joining and
// pluralization, both backed entirely by Intl (no translation content
// needed, correct in every locale today). Fixed English vocabulary
// ("today", "quiet until", "busy stretch", cadence words, connectors) is a
// separate, larger effort — sentence *assembly order* isn't universal, so
// it needs per-locale templates, not word-for-word substitution. This
// module is where that vocabulary would plug in once it exists: add a
// locale's PLURAL_FORMS entry and every pluralize() call picks it up.

const listFormatCache = new Map<string, Intl.ListFormat>();

/** "a, b, and c" — locale-correct list joining (conjunctions, separators, Oxford comma or not). */
export function joinList(items: string[], locale = "en-US"): string {
  let fmt = listFormatCache.get(locale);
  if (!fmt) {
    fmt = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listFormatCache.set(locale, fmt);
  }
  return fmt.format(items);
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/** One entry per Intl.PluralRules category this word distinguishes; "other" is required. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const PLURAL_FORMS: Record<string, Record<string, PluralForms>> = {
  en: {
    event: { one: "event", other: "events" },
  },
};

/**
 * The correctly-inflected form of `key` for `count` in `locale` — e.g.
 * `pluralize(1, "event", "en-US")` → "event", `pluralize(3, ...)` →
 * "events". Falls back to English if the locale has no vocabulary entry
 * yet (rather than throwing): partial translation coverage should degrade
 * gracefully, not break the digest.
 */
export function pluralize(count: number, key: string, locale = "en-US"): string {
  const lang = locale.split("-")[0]!;
  const forms = PLURAL_FORMS[lang]?.[key] ?? PLURAL_FORMS.en![key]!;
  const category = pluralRules(locale).select(count);
  return forms[category] ?? forms.other;
}
