'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorBox, Field, Input } from './ui';

type Result = { error?: unknown };

/**
 * Sensitive admin actions need a fresh TOTP (§8.0 step-up). `run(fn)` calls the action; if the API
 * answers step_up_required it asks for a code, confirms it, and retries once.
 */
export function useStepUp(): {
  run: (fn: () => Promise<Result>) => Promise<string | null>;
  dialog: ReactNode;
} {
  const { t, lang } = useT();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const ask = () =>
    new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setCode('');
      setError(null);
      setOpen(true);
    });

  const run = useCallback(
    async (fn: () => Promise<Result>) => {
      let res = await fn();
      const code = (res.error as { code?: string } | undefined)?.code;
      if (code === 'step_up_required') {
        if (!(await ask())) return t.web.admin.stepUpTitle;
        res = await fn();
      }
      return res.error ? errorText(lang, res.error as { code: string }) : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );

  const dialog = open ? (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-sm space-y-3">
        <h2 className="text-lg font-bold">{t.web.admin.stepUpTitle}</h2>
        <p className="text-sm">{t.web.admin.stepUpHint}</p>
        <Field label={t.web.admin.code}>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
        </Field>
        <ErrorBox message={error} />
        <div className="flex gap-2">
          <Button
            disabled={code.length !== 6}
            onClick={async () => {
              const { error: e } = await api.POST('/v1/auth/step-up', { body: { code } });
              if (e) return setError(errorText(lang, e));
              setOpen(false);
              pending.current?.(true);
            }}
          >
            {t.web.admin.verify}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              pending.current?.(false);
            }}
          >
            {t.web.common.cancel}
          </Button>
        </div>
      </Card>
    </div>
  ) : null;

  return { run, dialog };
}
