import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, errorMessage, interpolate, messages, type Locale } from '@vetlink/i18n';
import { kv } from './storage';

const KEY = 'lang';

interface LangContext {
  lang: Locale;
  setLang: (lang: Locale) => void;
}

const Ctx = createContext<LangContext>({ lang: DEFAULT_LOCALE, setLang: () => {} });

function stored(): Locale {
  const v = kv.get(KEY);
  return v === 'en' || v === 'sw' ? v : DEFAULT_LOCALE;
}

/** Swahili and English, switchable in the app (§11); the account's language wins after login. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Locale>(stored);
  const setLang = useCallback((l: Locale) => {
    kv.set(KEY, l);
    setState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangContext {
  return useContext(Ctx);
}

/** All text from @vetlink/i18n (invariant 7). The `web` namespace is shared by web and app. */
export function useT() {
  const { lang } = useLang();
  const fmt = useCallback(
    (template: string, params: Record<string, string | number>) => interpolate(template, params),
    [],
  );
  const err = useCallback(
    (e: { code?: string; message_key?: string } | null | undefined) => errorMessage(lang, e),
    [lang],
  );
  // `alt`: the other language, for bilingual labels ("Ng'ombe / Cow") that help low literacy.
  return { t: messages[lang], alt: messages[lang === 'sw' ? 'en' : 'sw'], fmt, err, lang };
}
