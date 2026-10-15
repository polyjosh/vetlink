'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Admin 2FA gate (§8.0): set up TOTP the first time, then verify on each session. */
export default function AdminVerify() {
  const { t, lang } = useT();
  const { api, me, reloadMe } = useSession();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const a = t.web.admin;
  const needsSetup = me?.admin && !me.admin.totpEnabled;

  useEffect(() => {
    if (me?.admin?.twoFactorVerified && !recovery) router.replace('/admin');
  }, [me, recovery, router]);
  useEffect(() => {
    if (needsSetup && !setup)
      void api.POST('/v1/auth/2fa/setup').then(({ data }) => setSetup(data ?? null));
  }, [api, needsSetup, setup]);

  if (recovery)
    return (
      <Shell title={a.recoveryTitle} role="admin">
        <Card className="space-y-3">
          <p>{a.recoveryHint}</p>
          <ul className="grid grid-cols-2 gap-2 font-mono">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button onClick={() => router.replace('/admin')}>{a.savedThem}</Button>
        </Card>
      </Shell>
    );

  return (
    <Shell title={needsSetup ? a.setupTitle : a.twoFactorTitle} role="admin">
      <Card className="space-y-4">
        {needsSetup ? (
          <>
            <p>{a.setupHint}</p>
            {setup && (
              <>
                <p>
                  <strong>{a.secret}: </strong>
                  <code className="break-all">{setup.secret}</code>
                </p>
                <a className="break-all text-sm underline" href={setup.otpauthUri}>
                  {setup.otpauthUri}
                </a>
              </>
            )}
          </>
        ) : (
          <p>{a.twoFactorHint}</p>
        )}
        <Field label={useRecovery ? a.recoveryCode : a.code}>
          <Input
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) =>
              setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))
            }
          />
        </Field>
        <ErrorBox message={error} />
        <Button
          disabled={!useRecovery && code.length !== 6}
          onClick={async () => {
            setError(null);
            if (needsSetup) {
              const { data, error: e } = await api.POST('/v1/auth/2fa/enable', { body: { code } });
              if (e || !data) return setError(errorText(lang, e));
              setRecovery(data.recoveryCodes);
              await reloadMe();
              return;
            }
            const { error: e } = await api.POST('/v1/auth/2fa/verify', {
              body: useRecovery ? { recoveryCode: code } : { code },
            });
            if (e) return setError(errorText(lang, e));
            await reloadMe();
            router.replace('/admin');
          }}
        >
          {needsSetup ? a.enable : a.verify}
        </Button>
        {!needsSetup && (
          <Button variant="ghost" onClick={() => setUseRecovery(!useRecovery)}>
            {useRecovery ? a.code : a.useRecovery}
          </Button>
        )}
      </Card>
    </Shell>
  );
}
