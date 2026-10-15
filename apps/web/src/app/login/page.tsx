'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function LoginForm() {
  const { t, fmt, lang } = useT();
  const { api, login } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error: e } = await api.POST('/v1/auth/otp/request', { body: { phone } });
    setBusy(false);
    if (e) setError(errorText(lang, e));
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const res = await login(phone, code);
    setBusy(false);
    if (!res.ok) setError(errorText(lang, res.error));
    else router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  return (
    <Shell title={t.web.auth.title}>
      <div className="space-y-4">
        {!sent ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <Field label={t.web.auth.phoneLabel} hint={t.web.auth.noAccountNeeded}>
              <Input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t.web.auth.phoneHint}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" disabled={busy || phone.length < 9} className="w-full">
              {t.web.auth.sendCode}
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <p>{fmt(t.web.auth.codeSent, { phone })}</p>
            <Field label={t.web.auth.codeLabel}>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {t.web.auth.verify}
            </Button>
            <div className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => void sendCode()}>
                {t.web.auth.resend}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSent(false);
                  setCode('');
                }}
              >
                {t.web.auth.wrongNumber}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
