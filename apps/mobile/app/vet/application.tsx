import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { APPLICATION_FIELDS, APPLICATION_STEPS, type ApplicationStep } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { colors } from '@vetlink/ui-tokens';
import { DocCapture } from '../../src/components/doc-capture';
import { Screen } from '../../src/components/screen';
import {
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Loading,
  Notice,
  P,
  s,
} from '../../src/components/ui';
import { WardPicker } from '../../src/components/ward-picker';
import { flushSoon } from '../../src/offline/sync';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

type App = Schemas['VetApplication'];
type Values = Record<string, unknown>;

/** Vet application wizard (§8.3): the same 7 steps as web, autosaved per step, resumable. */
export default function ApplicationWizard() {
  const { t, fmt, err } = useT();
  const { reloadMe } = useSession();
  const q = useApi(['application'], () => api.GET('/v1/vets/me/application'), {
    cache: 'vet:application',
    refetchInterval: 15_000,
  });
  const app = q.data;
  const [index, setIndex] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ApplicationStep, Values>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = t.web.application;

  if (!app)
    return (
      <Screen title={a.title} role="vet">
        <Loading label={t.web.common.loading} />
      </Screen>
    );
  if (['submitted', 'under_review', 'approved', 'rejected'].includes(app.status))
    return <Redirect href="/vet/status" />;

  const i = index ?? Math.min(Math.max(app.currentStep - 1, 0), APPLICATION_STEPS.length - 1);
  const step = APPLICATION_STEPS[i] ?? 'professional_type';
  const values: Values = drafts[step] ?? app.steps[step] ?? {};
  const vetType = (app.steps.professional_type?.vetType as string | undefined) ?? 'vet';
  const fields = APPLICATION_FIELDS[step].filter((f) => !f.vetOnly || vetType === 'vet');
  const editable = (name: string) =>
    app.editable === 'all' ||
    (app.editable === 'flagged' && app.flaggedFields.includes(`${step}.${name}`));
  const label = (name: string) => (a.fields as Record<string, string>)[name] ?? name;
  const optionLabel = (name: string, o: string) =>
    (
      ({
        vetType: { vet: t.web.onboarding.vetTypeVet, paravet: t.web.onboarding.vetTypeParavet },
        kvbCategory: a.kvbCategories,
        practiceType: a.practiceTypes,
        species: t.ussd.species,
        services: a.services,
        languages: a.languageNames,
      }) as Record<string, Record<string, string>>
    )[name]?.[o] ?? o;
  const set = (name: string, v: unknown) =>
    setDrafts((d) => ({ ...d, [step]: { ...values, [name]: v } }));

  async function save(): Promise<App | null> {
    const saved = app?.steps[step] ?? {};
    const body: Values = {};
    for (const f of fields) {
      const v = values[f.name];
      if (
        editable(f.name) &&
        v !== undefined &&
        v !== '' &&
        JSON.stringify(v) !== JSON.stringify(saved[f.name])
      )
        body[f.name] = v;
    }
    if (Object.keys(body).length === 0) return app ?? null;
    try {
      // One of seven literal step routes; the API's zod schema checks the body.
      const { data, error: e } = await api.PUT(
        `/v1/vets/me/application/steps/${step}` as '/v1/vets/me/application/steps/personal',
        { body: body as never },
      );
      if (!data) {
        setError(err(e));
        return null;
      }
      setDrafts((d) => ({ ...d, [step]: undefined }));
      await q.refetch();
      return data;
    } catch {
      setError(t.web.common.offline);
      return null;
    }
  }

  async function next() {
    setBusy(true);
    setError(null);
    if (await save()) setIndex(Math.min(i + 1, APPLICATION_STEPS.length - 1));
    setBusy(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    await flushSoon(); // documents first
    const saved = await save();
    if (saved) {
      try {
        const action = saved.status === 'changes_requested' ? 'resubmit' : 'submit';
        const { data, error: e } = await api.POST(
          `/v1/vets/me/application/${action}` as '/v1/vets/me/application/submit',
        );
        if (!data) setError(err(e));
        else {
          await reloadMe();
          router.replace('/vet/status');
        }
      } catch {
        setError(t.web.common.offline);
      }
    }
    setBusy(false);
  }

  return (
    <Screen title={a.title} role="vet">
      <P muted>{fmt(a.stepOf, { n: i + 1, total: APPLICATION_STEPS.length })}</P>
      <H2>{a.steps[step]}</H2>
      {app.status === 'changes_requested' && app.decision && (
        <Notice tone="warning">{`${a.changesTitle}: ${app.decision.reasons.map((r) => t.application.reasons[r]).join('; ')}${app.decision.note ? `. ${app.decision.note}` : ''}`}</Notice>
      )}
      <Card>
        {fields.map((f) => {
          const v = values[f.name];
          const off = !editable(f.name);
          if (f.kind === 'ward')
            return (
              <WardPicker
                key={f.name}
                value={(v as number | undefined) ?? null}
                onChange={(id) => set(f.name, id)}
              />
            );
          if (f.kind === 'bool')
            return (
              <View key={f.name} style={[s.row, { minHeight: 48 }]}>
                <Switch
                  value={v === true}
                  disabled={off}
                  onValueChange={(x) => set(f.name, x)}
                  trackColor={{ true: colors.brand }}
                  accessibilityLabel={label(f.name)}
                />
                <P>{label(f.name)}</P>
              </View>
            );
          if (f.kind === 'enum' || f.kind === 'multi') {
            const arr = (v as string[] | undefined) ?? [];
            return (
              <View key={f.name} style={{ gap: 6 }}>
                <P>{label(f.name)}</P>
                <Choices
                  multi={f.kind === 'multi'}
                  options={(f.options ?? []).map((o) => ({
                    value: o,
                    label: optionLabel(f.name, o),
                  }))}
                  value={f.kind === 'multi' ? arr : ((v as string | undefined) ?? null)}
                  onChange={(o) => {
                    if (off) return;
                    if (f.kind === 'enum') set(f.name, o);
                    else set(f.name, arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
                  }}
                />
              </View>
            );
          }
          const idHint =
            f.name === 'nationalId' && typeof app.steps.personal?.nationalIdLast3 === 'string'
              ? fmt(a.fields.nationalIdSaved, { last3: app.steps.personal.nationalIdLast3 })
              : undefined;
          return (
            <Field
              key={f.name}
              label={
                f.kind === 'textarea'
                  ? `${label(f.name)} (${t.web.common.optional})`
                  : label(f.name)
              }
              hint={f.kind === 'date' ? 'YYYY-MM-DD' : idHint}
              editable={!off}
              multiline={f.kind === 'textarea'}
              keyboardType={
                f.kind === 'int' || f.name === 'nationalId'
                  ? 'number-pad'
                  : f.kind === 'tel'
                    ? 'phone-pad'
                    : f.kind === 'email'
                      ? 'email-address'
                      : 'default'
              }
              value={v === undefined || v === null ? '' : String(v)}
              onChangeText={(x) =>
                set(f.name, f.kind === 'int' ? (x === '' ? '' : Number(x.replace(/\D/g, ''))) : x)
              }
            />
          );
        })}
      </Card>
      {step === 'declaration' && (
        <Card>
          <H2>{a.documents}</H2>
          <P muted>{a.photoTips}</P>
          {app.requiredDocuments.map((kind) => (
            <DocCapture
              key={kind}
              kind={kind}
              doc={app.documents.find((d) => d.kind === kind)}
              disabled={
                app.editable === 'none' ||
                (app.editable === 'flagged' && !app.flaggedFields.includes(`doc.${kind}`))
              }
            />
          ))}
          {(app.missing.fields.length > 0 || app.missing.documents.length > 0) && (
            <Notice tone="warning">{`${a.missingTitle}: ${[...app.missing.fields.map((x) => label(x.split('.').pop() ?? x)), ...app.missing.documents.map((d) => a.docKinds[d])].join(', ')}`}</Notice>
          )}
        </Card>
      )}
      <ErrorText message={error} />
      <View style={s.row}>
        {i > 0 && (
          <Button
            title={t.web.common.back}
            variant="secondary"
            disabled={busy}
            onPress={() => setIndex(i - 1)}
          />
        )}
        {i < APPLICATION_STEPS.length - 1 ? (
          <Button title={t.web.common.next} disabled={busy} onPress={() => void next()} />
        ) : (
          <Button
            title={app.status === 'changes_requested' ? a.resubmit : a.submit}
            disabled={busy}
            onPress={() => void submit()}
          />
        )}
      </View>
      <Button
        title={a.saveLater}
        variant="ghost"
        disabled={busy}
        onPress={async () => {
          if (await save()) router.push('/vet/status');
        }}
      />
    </Screen>
  );
}
