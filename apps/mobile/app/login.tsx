import { router } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../src/components/screen';
import { Button, ErrorText, Field, P } from '../src/components/ui';
import { useT } from '../src/lib/i18n';
import { api, useSession } from '../src/lib/session';

export default function Login() {
  const { t, fmt, err } = useT();
  const { login } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.auth;

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await api.POST('/v1/auth/otp/request', { body: { phone } });
      if (e) setError(err(e));
      else setSent(true);
    } catch {
      setError(t.web.common.offline);
    }
    setBusy(false);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await login(phone, code);
      if (res.error) setError(err(res.error));
      else router.replace('/');
    } catch {
      setError(t.web.common.offline);
    }
    setBusy(false);
  }

  return (
    <Screen title={a.title}>
      {!sent ? (
        <>
          <Field
            label={a.phoneLabel}
            hint={a.noAccountNeeded}
            placeholder={a.phoneHint}
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
            testID="phone"
          />
          <ErrorText message={error} />
          <Button
            title={a.sendCode}
            disabled={busy || phone.length < 9}
            onPress={() => void sendCode()}
            testID="send-code"
          />
        </>
      ) : (
        <>
          <P>{fmt(a.codeSent, { phone })}</P>
          <Field
            label={a.codeLabel}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            testID="code"
          />
          <ErrorText message={error} />
          <Button
            title={a.verify}
            disabled={busy || code.length !== 6}
            onPress={() => void verify()}
            testID="verify"
          />
          <Button title={a.resend} variant="ghost" onPress={() => void sendCode()} />
          <Button
            title={a.wrongNumber}
            variant="ghost"
            onPress={() => {
              setSent(false);
              setCode('');
            }}
          />
        </>
      )}
    </Screen>
  );
}
