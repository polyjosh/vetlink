'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DEFAULT_LOCALE, interpolate, messages, type Locale } from '@vetlink/i18n';

const STORAGE_KEY = 'vl_lang';

// The chosen language lives in localStorage (kept in memory too when storage is blocked).
let memory: Locale | null = null;
const listeners = new Set<() => void>();

function readLang(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'sw' || saved === 'en') return saved;
  } catch {
    // storage blocked
  }
  return memory ?? DEFAULT_LOCALE;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

interface LangContext {
  lang: Locale;
  setLang: (lang: Locale) => void;
}

const Ctx = createContext<LangContext>({ lang: DEFAULT_LOCALE, setLang: () => {} });

/** The UI language: the user's saved language once known, else this browser's last choice. */
export function LangProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => DEFAULT_LOCALE);
  const setLang = useCallback((l: Locale) => {
    memory = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    document.documentElement.lang = l;
    for (const notify of listeners) notify();
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangContext {
  return useContext(Ctx);
}

type Messages = (typeof messages)['en'];

/** All UI text comes from @vetlink/i18n (invariant 7): `t.web.farmer.requestVet`, `fmt(...)`. */
export function useT() {
  const { lang } = useLang();
  const m: Messages = messages[lang];
  const fmt = useCallback(
    (template: string, params: Record<string, string | number>) => interpolate(template, params),
    [],
  );
  return { t: m, fmt, lang };
}
