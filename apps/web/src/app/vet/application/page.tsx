'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { APPLICATION_FIELDS, APPLICATION_STEPS, type ApplicationStep } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { DocUpload } from '@/components/doc-upload';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
  TextArea,
} from '@/components/ui';
import { WardPicker } from '@/components/ward-picker';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type App = Schemas['VetApplication'];

type Values = Record<string, unknown>;

/** Vet application wizard (§8.3): autosaves each step, resumable, flagged-only edits on changes. */
export default function ApplicationWizard() {
  const { t, fmt, lang } = useT();
  const { api, reloadMe } = useSession();
  const router = useRouter();
  const [app, setApp] = useState<App | null>(null);
  const [index, setIndex] = useState(0);
  // Unsaved edits per step; a step without edits shows what the server has.
  const [drafts, setDrafts] = useState<Partial<Record<ApplicationStep, Values>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.GET('/v1/vets/me/application').then(({ data, error: e }) => {
      if (e || !data) return setError(errorText(lang, e));
      setApp(data);
      if (
        data.status === 'submitted' ||
        data.status === 'under_review' ||
        data.status === 'approved' ||
        data.status === 'rejected'
      ) {
        router.replace('/vet/status');
        return;
      }
      setIndex(Math.min(Math.max(data.currentStep - 1, 0), APPLICATION_STEPS.length - 1));
    });
  }, [api, lang, router]);

  const step = APPLICATION_STEPS[index] ?? 'professional_type';
  const values: Values = drafts[step] ?? app?.steps[step] ?? {};

  const vetType = (app?.steps.professional_type?.vetType as string | undefined) ?? 'vet';
  const fields = useMemo(
    () => APPLICATION_FIELDS[step].filter((f) => !f.vetOnly || vetType === 'vet'),
    [step, vetType],
  );

  if (!app)
    return (
      <Shell title={t.web.application.title} role="vet">
        {error ? <ErrorBox message={error} /> : <Spinner label={t.web.common.loading} />}
      </Shell>
    );

  const editableField = (name: string) =>
    app.editable === 'all' ||
    (app.editable === 'flagged' && app.flaggedFields.includes(`${step}.${name}`));
  const label = (name: string) =>
    (t.web.application.fields as Record<string, string>)[name] ?? name;
  const optionLabel = (name: string, o: string): string => {
    const a = t.web.application;
    const tables: Record<string, Record<string, string>> = {
      vetType: { vet: t.web.onboarding.vetTypeVet, paravet: t.web.onboarding.vetTypeParavet },
      kvbCategory: a.kvbCategories,
      practiceType: a.practiceTypes,
      species: t.ussd.species,
      services: a.services,
      languages: a.languageNames,
    };
    return tables[name]?.[o] ?? o;
  };

  /** Only send what changed and is editable; empty strings are left out (autosave takes subsets). */
  function payload(): Values {
    const saved = app?.steps[step] ?? {};
    const out: Values = {};
    for (const f of fields) {
      const v = values[f.name];
      if (
        !editableField(f.name) ||
        v === undefined ||
        v === '' ||
        JSON.stringify(v) === JSON.stringify(saved[f.name])
      )
        continue;
      out[f.name] = v;
    }
    return out;
  }

  async function save(): Promise<App | null> {
    const body = payload();
    if (Object.keys(body).length === 0) return app;
    // The step path is one of seven literal routes; the body is checked by the API's zod schema.
    const { data, error: e } = await api.PUT(
      `/v1/vets/me/application/steps/${step}` as '/v1/vets/me/application/steps/personal',
      { body: body as never },
    );
    if (e || !data) {
      setError(errorText(lang, e));
      return null;
    }
    setApp(data);
    setDrafts((d) => ({ ...d, [step]: undefined }));
    return data;
  }

  async function next() {
    setBusy(true);
    setError(null);
    const saved = await save();
    setBusy(false);
    if (saved && index < APPLICATION_STEPS.length - 1) setIndex(index + 1);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const saved = await save();
    if (!saved) return setBusy(false);
    const action = saved.status === 'changes_requested' ? 'resubmit' : 'submit';
    const { data, error: e } = await api.POST(
      `/v1/vets/me/application/${action}` as '/v1/vets/me/application/submit',
    );
    setBusy(false);
    if (e || !data) return setError(errorText(lang, e));
    await reloadMe();
    router.replace('/vet/status');
  }

  const set = (name: string, v: unknown) =>
    setDrafts((d) => ({ ...d, [step]: { ...values, [name]: v } }));
  const last = index === APPLICATION_STEPS.length - 1;
  const docsEditable = app.editable === 'all' || app.editable === 'flagged';

  return (
    <Shell title={t.web.application.title} role="vet">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {fmt(t.web.application.stepOf, { n: index + 1, total: APPLICATION_STEPS.length })}
        </p>
        <h2 className="text-xl font-bold">{t.web.application.steps[step]}</h2>
        {app.status === 'changes_requested' && app.decision && (
          <Notice tone="warning">
            <strong>{t.web.application.changesTitle}: </strong>
            {app.decision.reasons.map((r) => t.application.reasons[r]).join('; ')}
            {app.decision.note && <p>{app.decision.note}</p>}
          </Notice>
        )}
        <Card className="space-y-4">
          {fields.map((f) => {
            const v = values[f.name];
            const disabled = !editableField(f.name);
            const name = f.name;
            if (f.kind === 'ward')
              return (
                <WardPicker
                  key={name}
                  value={(v as number | undefined) ?? null}
                  onChange={(id) => set(name, id)}
                />
              );
            if (f.kind === 'bool')
              return (
                <label key={name} className="flex min-h-touch items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-6"
                    checked={v === true}
                    disabled={disabled}
                    onChange={(e) => set(name, e.target.checked)}
                  />
                  <span>{label(name)}</span>
                </label>
              );
            if (f.kind === 'multi') {
              const arr = (v as string[] | undefined) ?? [];
              return (
                <fieldset key={name} className="space-y-2">
                  <legend className="font-semibold">{label(name)}</legend>
                  <div className="flex flex-wrap gap-2">
                    {f.options?.map((o) => (
                      <label
                        key={o}
                        className={`flex min-h-touch items-center gap-2 rounded-full border px-3 ${arr.includes(o) ? 'border-brand bg-brand-light' : 'border-line'}`}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={arr.includes(o)}
                          onChange={(e) =>
                            set(name, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))
                          }
                        />
                        {optionLabel(name, o)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            if (f.kind === 'enum')
              return (
                <Field key={name} label={label(name)}>
                  <Select
                    value={(v as string | undefined) ?? ''}
                    disabled={disabled}
                    onChange={(e) => set(name, e.target.value)}
                  >
                    <option value="">{t.web.common.choose}</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {optionLabel(name, o)}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            if (f.kind === 'textarea')
              return (
                <Field key={name} label={`${label(name)} (${t.web.common.optional})`}>
                  <TextArea
                    rows={3}
                    maxLength={300}
                    value={(v as string | undefined) ?? ''}
                    disabled={disabled}
                    onChange={(e) => set(name, e.target.value)}
                  />
                </Field>
              );
            const hint =
              name === 'nationalId' && typeof app.steps.personal?.nationalIdLast3 === 'string'
                ? fmt(t.web.application.fields.nationalIdSaved, {
                    last3: app.steps.personal.nationalIdLast3,
                  })
                : undefined;
            return (
              <Field key={name} label={label(name)} hint={hint}>
                <Input
                  name={name}
                  disabled={disabled}
                  type={
                    f.kind === 'int'
                      ? 'number'
                      : f.kind === 'date'
                        ? 'date'
                        : f.kind === 'tel'
                          ? 'tel'
                          : f.kind === 'email'
                            ? 'email'
                            : 'text'
                  }
                  inputMode={f.kind === 'int' || name === 'nationalId' ? 'numeric' : undefined}
                  value={v === undefined || v === null ? '' : String(v)}
                  onChange={(e) =>
                    set(
                      name,
                      f.kind === 'int'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              </Field>
            );
          })}
        </Card>

        {step === 'declaration' && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{t.web.application.documents}</h2>
            <p className="text-sm text-muted">{t.web.application.photoTips}</p>
            {app.requiredDocuments.map((kind) => (
              <DocUpload
                key={kind}
                kind={kind}
                doc={app.documents.find((d) => d.kind === kind)}
                disabled={
                  !docsEditable ||
                  (app.editable === 'flagged' && !app.flaggedFields.includes(`doc.${kind}`))
                }
                onDone={setApp}
              />
            ))}
            {(app.missing.fields.length > 0 || app.missing.documents.length > 0) && (
              <Notice tone="warning">
                <strong>{t.web.application.missingTitle}: </strong>
                {[
                  ...app.missing.fields.map((f) => label(f.split('.').pop() ?? f)),
                  ...app.missing.documents.map((d) => t.web.application.docKinds[d]),
                ].join(', ')}
              </Notice>
            )}
          </Card>
        )}

        <ErrorBox message={error} />
        <div className="flex flex-wrap gap-2">
          {index > 0 && (
            <Button variant="secondary" disabled={busy} onClick={() => setIndex(index - 1)}>
              {t.web.common.back}
            </Button>
          )}
          {!last ? (
            <Button disabled={busy} onClick={() => void next()}>
              {t.web.common.next}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void submit()}>
              {app.status === 'changes_requested'
                ? t.web.application.resubmit
                : t.web.application.submit}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (await save()) router.push('/vet/status');
            }}
          >
            {t.web.application.saveLater}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
