'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Icon,
  Input,
  LanguageToggle,
  Logo,
  PhoneInput,
  withCountryCode,
} from '@/components/ui';
import { USSD_CODE } from '@/lib/config';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function LoginForm() {
  const { t, fmt, lang } = useT();
  const a = t.web.auth;
  const { api, login } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullPhone = withCountryCode(phone);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error: e } = await api.POST('/v1/auth/otp/request', { body: { phone: fullPhone } });
    setBusy(false);
    if (e) setError(errorText(lang, e));
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const res = await login(fullPhone, code);
    setBusy(false);
    if (!res.ok) setError(errorText(lang, res.error));
    else router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col sm:py-10">
      <header className="flex flex-col gap-8 rounded-b-sheet bg-primary px-6 pt-7 pb-10 text-on-primary sm:rounded-sheet">
        <div className="flex items-center justify-between gap-3">
          <Logo boxed={false} />
          <LanguageToggle inverse />
        </div>
        <div>
          <h1 className="text-display tracking-tight">{a.tagline}</h1>
          <p className="mt-3 text-on-primary-muted">{a.taglineHint}</p>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-5 px-6 pt-8 pb-6">
        {!sent ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <Field label={a.phoneLabel} hint={a.codeBySms}>
              <PhoneInput
                name="phone"
                placeholder={a.localPlaceholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <ErrorBox message={error} />
            <Button
              type="submit"
              size="lg"
              disabled={busy || phone.replace(/\D/g, '').length < 9}
              className="w-full"
            >
              {a.sendCode}
            </Button>
            <p className="text-small text-ink-muted">{a.noAccountNeeded}</p>
          </form>
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <p>{fmt(a.codeSent, { phone: fullPhone })}</p>
            <Field label={a.codeLabel}>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                className="min-h-input text-button tracking-widest"
              />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="w-full">
              {a.verify}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => void sendCode()}>
                {a.resend}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSent(false);
                  setCode('');
                }}
              >
                {a.wrongNumber}
              </Button>
            </div>
          </form>
        )}
        {USSD_CODE && (
          <Card as="aside" className="mt-auto flex items-center gap-3.5 !p-4">
            <span className="flex size-chip shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning">
              <Icon name="phone" />
            </span>
            <span className="text-small">
              <span className="block font-bold">{a.ussdTitle}</span>
              <span className="block text-ink-muted">{fmt(a.ussdDial, { code: USSD_CODE })}</span>
            </span>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
