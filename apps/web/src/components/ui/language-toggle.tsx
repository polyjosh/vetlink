'use client';

import type { Locale } from '@vetlink/i18n';
import { useLang, useT } from '@/lib/i18n';

/** EN / SW segmented pill wired to the app's language switch. */
export function LanguageToggle({ inverse }: { inverse?: boolean }) {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const options: { value: Locale; short: string; name: string }[] = [
    { value: 'en', short: t.web.ui.langEn, name: t.web.common.english },
    { value: 'sw', short: t.web.ui.langSw, name: t.web.common.swahili },
  ];
  return (
    <div
      role="group"
      aria-label={t.web.common.language}
      className={`inline-flex rounded-full p-1 ${inverse ? 'bg-primary-pressed' : 'bg-primary-soft'}`}
    >
      {options.map((o) => {
        const on = lang === o.value;
        return (
          <button
            key={o.value}
            type="button"
            lang={o.value}
            aria-pressed={on}
            aria-label={o.name}
            onClick={() => setLang(o.value)}
            className={`min-h-touch min-w-touch rounded-full px-3 text-small font-bold ${
              on
                ? 'bg-surface text-ink shadow-raised'
                : inverse
                  ? 'text-on-primary'
                  : 'text-primary'
            }`}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
