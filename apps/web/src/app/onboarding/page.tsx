'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, ChoiceGrid, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { WardPicker } from '@/components/ward-picker';
import { errorText } from '@/lib/errors';
import { useLang, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Step = 'language' | 'consent' | 'role' | 'farm';

/** First run (§8.2): language, consent, role; farmers then give their name and ward. */
export default function Onboarding() {
  const { t, lang } = useT();
  const { setLang } = useLang();
  const { api, me, status, reloadMe } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>('language');
  const [role, setRole] = useState<'farmer' | 'vet' | null>(null);
  const [vetType, setVetType] = useState<'vet' | 'paravet' | null>(null);
  const [name, setName] = useState('');
  const [wardId, setWardId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signed_out') router.replace('/login');
  }, [status, router]);

  if (!me) return <Spinner label={t.web.common.loading} />;

  // Steps already done on another channel or device are skipped.
  const current: Step =
    step === 'consent' && me.onboarding.consented
      ? 'role'
      : step === 'role' && me.onboarding.roleChosen && me.roles.includes('farmer')
        ? 'farm'
        : step;

  const run = async (fn: () => Promise<{ error?: unknown }>, then: () => void) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(errorText(lang, e as { code: string; message_key: string }));
    else then();
  };

  return (
    <Shell
      title={
        {
          language: t.web.onboarding.chooseLanguage,
          consent: t.web.onboarding.consentTitle,
          role: t.web.onboarding.chooseRole,
          farm: t.web.onboarding.farmTitle,
        }[current]
      }
    >
      <div className="space-y-6">
        {current === 'language' && (
          <>
            <ChoiceGrid
              options={[
                { value: 'sw', label: t.web.common.swahili },
                { value: 'en', label: t.web.common.english },
              ]}
              value={lang}
              onChange={(l) => setLang(l)}
            />
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.PATCH('/v1/me', { body: { language: lang } }),
                  () => setStep('consent'),
                )
              }
            >
              {t.web.common.next}
            </Button>
          </>
        )}
        {current === 'consent' && (
          <>
            <p>{t.web.onboarding.consentBody}</p>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.POST('/v1/me/consent'),
                  () => setStep('role'),
                )
              }
            >
              {t.web.onboarding.consentAgree}
            </Button>
          </>
        )}
        {current === 'role' && (
          <>
            <ChoiceGrid
              options={[
                {
                  value: 'farmer',
                  label: `${t.web.onboarding.roleFarmer}: ${t.web.onboarding.roleFarmerHint}`,
                },
                {
                  value: 'vet',
                  label: `${t.web.onboarding.roleVet}: ${t.web.onboarding.roleVetHint}`,
                },
              ]}
              value={role}
              onChange={setRole}
            />
            {role === 'vet' && (
              <>
                <p className="font-semibold">{t.web.onboarding.vetTypeQuestion}</p>
                <ChoiceGrid
                  options={[
                    { value: 'vet', label: t.web.onboarding.vetTypeVet },
                    { value: 'paravet', label: t.web.onboarding.vetTypeParavet },
                  ]}
                  value={vetType}
                  onChange={setVetType}
                />
              </>
            )}
            <Button
              className="w-full"
              disabled={busy || !role || (role === 'vet' && !vetType)}
              onClick={() =>
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
            >
              {t.web.common.next}
            </Button>
          </>
        )}
        {current === 'farm' && (
          <>
            <Field label={t.web.onboarding.nameLabel}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <WardPicker value={wardId} onChange={setWardId} />
            <Field label={t.web.onboarding.farmNotesLabel} hint={t.web.onboarding.farmNotesHint}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <ErrorBox message={error} />
            <Button
              className="w-full"
              disabled={busy || !wardId || name.trim().length === 0}
              onClick={() =>
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
            >
              {t.web.onboarding.finish}
            </Button>
          </>
        )}
        {current !== 'farm' && <ErrorBox message={error} />}
      </div>
    </Shell>
  );
}
