import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, layout, radius, size, space, tone, type } from '@vetlink/ui-tokens';
import { Screen } from '../src/components/screen';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Icon,
  LanguageToggle,
  LogoMark,
  P,
  PhoneInput,
  Text,
  withCountryCode,
} from '../src/components/ui';
import { USSD_CODE } from '../src/lib/config';
import { useT } from '../src/lib/i18n';
import { api, useSession } from '../src/lib/session';

/** Green header block with rounded bottom corners (Login.dc.html). */
function LoginHeader() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.header, { paddingTop: insets.top + space[6] }]}>
      <View style={st.headerRow}>
        <View style={st.brandRow}>
          <LogoMark />
          <Text style={st.brand}>VetLink</Text>
        </View>
        <LanguageToggle inverse />
      </View>
      <View>
        <Text accessibilityRole="header" style={st.tagline}>
          {t.web.auth.tagline}
        </Text>
        <Text style={st.taglineHint}>{t.web.auth.taglineHint}</Text>
      </View>
    </View>
  );
}

export default function Login() {
  const { t, fmt, err } = useT();
  const { login } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.auth;
  const fullPhone = withCountryCode(phone);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await api.POST('/v1/auth/otp/request', { body: { phone: fullPhone } });
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
      const res = await login(fullPhone, code);
      if (res.error) setError(err(res.error));
      else router.replace('/');
    } catch {
      setError(t.web.common.offline);
    }
    setBusy(false);
  }

  return (
    <Screen title={a.title} header={<LoginHeader />}>
      <View style={st.body}>
        {!sent ? (
          <>
            <PhoneInput
              label={a.phoneLabel}
              hint={a.codeBySms}
              placeholder={a.localPlaceholder}
              value={phone}
              onChangeText={setPhone}
              testID="phone"
            />
            <ErrorText message={error} />
            <Button
              title={a.sendCode}
              size="lg"
              disabled={busy || phone.replace(/\D/g, '').length < 9}
              onPress={() => void sendCode()}
              testID="send-code"
            />
            <P muted>{a.noAccountNeeded}</P>
          </>
        ) : (
          <>
            <P>{fmt(a.codeSent, { phone: fullPhone })}</P>
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
              size="lg"
              disabled={busy || code.length !== 6}
              onPress={() => void verify()}
              testID="verify"
            />
            <View style={st.row}>
              <Button title={a.resend} variant="ghost" onPress={() => void sendCode()} />
              <Button
                title={a.wrongNumber}
                variant="ghost"
                onPress={() => {
                  setSent(false);
                  setCode('');
                }}
              />
            </View>
          </>
        )}
        {USSD_CODE ? (
          <Card style={st.ussd}>
            <View style={st.ussdIcon}>
              <Icon name="phone" color={tone.warning.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.ussdTitle}>{a.ussdTitle}</Text>
              <Text style={st.ussdText}>{fmt(a.ussdDial, { code: USSD_CODE })}</Text>
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: {
    backgroundColor: color.primary,
    paddingHorizontal: layout.mobileGutter,
    paddingBottom: space[10],
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    gap: space[8],
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: color.onPrimary, fontSize: type.heading.size, fontWeight: '800' },
  tagline: {
    color: color.onPrimary,
    fontSize: type.display.size,
    lineHeight: type.display.line,
    fontWeight: '800',
    letterSpacing: type.display.tracking,
  },
  taglineHint: { color: color.onPrimaryMuted, marginTop: space[3], lineHeight: type.body.line },
  body: { paddingTop: space[4], gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  ussd: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[6] },
  ussdIcon: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.md,
    backgroundColor: tone.warning.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ussdTitle: { fontSize: type.small.size, fontWeight: '700' },
  ussdText: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
});
