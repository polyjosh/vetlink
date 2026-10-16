import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../src/components/screen';
import { Button, Choices, ErrorText, Field, Loading, P } from '../src/components/ui';
import { WardPicker } from '../src/components/ward-picker';
import { useLang, useT } from '../src/lib/i18n';
import { api, useSession } from '../src/lib/session';

type Step = 'language' | 'consent' | 'role' | 'farm';

/** First run (§8.2): language, consent, role; farmers then give their name and ward. */
export default function Onboarding() {
  const { t, err, lang } = useT();
  const { setLang } = useLang();
  const { me, status, reloadMe } = useSession();
  const [step, setStep] = useState<Step>('language');
  const [role, setRole] = useState<'farmer' | 'vet' | null>(null);
  const [vetType, setVetType] = useState<'vet' | 'paravet' | null>(null);
  const [name, setName] = useState('');
  const [wardId, setWardId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = t.web.onboarding;

  if (status === 'signed_out') return <Redirect href="/login" />;
  if (!me) return <Loading label={t.web.common.loading} />;

  // Steps already done on another channel or device are skipped.
  const current: Step =
    step === 'consent' && me.onboarding.consented
      ? 'role'
      : step === 'role' && me.onboarding.roleChosen && me.roles.includes('farmer')
        ? 'farm'
        : step;

  const run = async (fn: () => Promise<{ error?: unknown }>, then: () => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) setError(err(e as { code: string }));
      else await then();
    } catch {
      setError(t.web.common.offline);
    }
    setBusy(false);
  };

  const title = {
    language: o.chooseLanguage,
    consent: o.consentTitle,
    role: o.chooseRole,
    farm: o.farmTitle,
  }[current];
  return (
    <Screen title={title}>
      {current === 'language' && (
        <>
          <Choices
            options={[
              { value: 'sw' as const, label: t.web.common.swahili },
              { value: 'en' as const, label: t.web.common.english },
            ]}
            value={lang}
            onChange={setLang}
          />
          <Button
            title={t.web.common.next}
            disabled={busy}
            onPress={() =>
              void run(
                () => api.PATCH('/v1/me', { body: { language: lang } }),
                () => setStep('consent'),
              )
            }
          />
        </>
      )}
      {current === 'consent' && (
        <>
          <P>{o.consentBody}</P>
          <Button
            title={o.consentAgree}
            disabled={busy}
            onPress={() =>
              void run(
                () => api.POST('/v1/me/consent'),
                () => setStep('role'),
              )
            }
          />
        </>
      )}
      {current === 'role' && (
        <>
          <Choices
            options={[
              { value: 'farmer' as const, label: `${o.roleFarmer}: ${o.roleFarmerHint}` },
              { value: 'vet' as const, label: `${o.roleVet}: ${o.roleVetHint}` },
            ]}
            value={role}
            onChange={setRole}
          />
          {role === 'vet' && (
            <>
              <P>{o.vetTypeQuestion}</P>
              <Choices
                options={[
                  { value: 'vet' as const, label: o.vetTypeVet },
                  { value: 'paravet' as const, label: o.vetTypeParavet },
                ]}
                value={vetType}
                onChange={setVetType}
              />
            </>
          )}
          <Button
            title={t.web.common.next}
            disabled={busy || !role || (role === 'vet' && !vetType)}
            onPress={() =>
              void run(
                () =>
                  api.POST('/v1/me/roles', {
                    body:
                      role === 'vet'
                        ? { role: 'vet', vetType: vetType ?? 'vet' }
                        : { role: 'farmer' },
                  }),
                async () => {
                  await reloadMe();
                  if (role === 'vet') router.replace('/vet/application');
                  else setStep('farm');
                },
              )
            }
          />
        </>
      )}
      {current === 'farm' && (
        <>
          <Field label={o.nameLabel} value={name} onChangeText={setName} autoComplete="name" />
          <WardPicker value={wardId} onChange={setWardId} />
          <Field
            label={o.farmNotesLabel}
            hint={o.farmNotesHint}
            value={notes}
            onChangeText={setNotes}
          />
          <Button
            title={o.finish}
            disabled={busy || !wardId || !name.trim()}
            onPress={() =>
              void run(
                async () => {
                  const a = await api.PATCH('/v1/me', { body: { name } });
                  if (a.error) return a;
                  return api.PUT('/v1/farmers/me', {
                    body: { wardId: wardId ?? 0, ...(notes && { farmNotes: notes }) },
                  });
                },
                async () => {
                  await reloadMe();
                  router.replace('/farmer');
                },
              )
            }
          />
        </>
      )}
      <ErrorText message={error} />
    </Screen>
  );
}
