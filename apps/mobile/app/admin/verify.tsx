import { router } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../../src/components/screen';
import { Button, Card, ErrorText, Field, P } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

/** Admin 2FA gate (§8.0): set up TOTP the first time, then verify each session. */
export default function AdminVerify() {
  const { t, err } = useT();
  const { me, reloadMe } = useSession();
  const needsSetup = !!me?.admin && !me.admin.totpEnabled;
  const setup = useApi(['2fa-setup'], () => api.POST('/v1/auth/2fa/setup'), {
    enabled: needsSetup,
  });
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.admin;

  if (recovery)
    return (
      <Screen title={a.recoveryTitle} role="admin">
        <Card>
          <P>{a.recoveryHint}</P>
          {recovery.map((c) => (
            <P key={c}>{c}</P>
          ))}
          <Button title={a.savedThem} onPress={() => router.replace('/admin')} />
        </Card>
      </Screen>
    );

  return (
    <Screen title={needsSetup ? a.setupTitle : a.twoFactorTitle} role="admin">
      <Card>
        <P>{needsSetup ? a.setupHint : a.twoFactorHint}</P>
        {needsSetup && setup.data && <P>{`${a.secret}: ${setup.data.secret}`}</P>}
        <Field
          label={a.code}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        />
        <ErrorText message={error} />
        <Button
          title={needsSetup ? a.enable : a.verify}
          disabled={code.length !== 6}
          onPress={async () => {
            setError(null);
            try {
              if (needsSetup) {
                const { data, error: e } = await api.POST('/v1/auth/2fa/enable', {
                  body: { code },
                });
                if (!data) return setError(err(e));
                setRecovery(data.recoveryCodes);
              } else {
                const { error: e } = await api.POST('/v1/auth/2fa/verify', { body: { code } });
                if (e) return setError(err(e));
                router.replace('/admin');
              }
              await reloadMe();
            } catch {
              setError(t.web.common.offline);
            }
          }}
        />
      </Card>
    </Screen>
  );
}
