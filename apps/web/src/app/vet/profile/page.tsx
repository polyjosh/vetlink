'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  DEFAULT_WORKING_HOURS,
  SPECIES,
  VET_SERVICES,
  type Species,
  type VetService,
  type WorkingHours,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { PersonAvatar } from '@/components/pictures';
import { FeesEditor, HoursEditor } from '@/components/prices';
import { BadgeChips } from '@/components/ratings';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, ErrorBox, Field, Input, Notice, Spinner } from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { WardPicker } from '@/components/ward-picker';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

type Profile = Schemas['VetProfile'];
type Body = NonNullable<Parameters<ReturnType<typeof useSession>['api']['PATCH']>[1]>['body'];

/** The vet's own profile (§24.3): qualifications, documents, practice and prices. */
export default function VetProfilePage() {
  const { t, fmt, lang } = useT();
  const { api, me } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  // Edits over the saved profile; only changed fields are sent.
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/vets/me');
    setProfile(data ?? null);
  }, [api]);
  useLoad(load);

  if (!profile || !me) return <Spinner label={t.web.common.loading} />;
  const v = { ...profile, ...draft };
  const set = (patch: Partial<Profile>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  const p = t.web.prices;
  const vp = t.web.vetProfile;
  const fieldLabel = (f: string) => {
    const name = f.split('.')[0] ?? f;
    const service = f.split('.')[1];
    if (service) return t.web.application.services[service as VetService];
    return (t.web.application.fields as Record<string, string>)[name] ?? name;
  };

  async function save() {
    setError(null);
    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(draft)) {
      const key = k === 'premisesWard' ? 'premisesWardId' : k;
      body[key] = k === 'premisesWard' ? ((val as Profile['premisesWard'])?.id ?? null) : val;
    }
    const { data, error: e } = await api.PATCH('/v1/vets/me/profile', {
      body: body as Body,
    });
    if (e || !data) {
      const fields = (e as { details?: { fields?: string[] } } | undefined)?.details?.fields;
      return setError(
        fields?.length
          ? `${errorText(lang, e)} (${fields.map(fieldLabel).join(', ')})`
          : errorText(lang, e),
      );
    }
    setProfile(data);
    setDraft({});
    setSaved(true);
  }

  async function openDoc(id: number) {
    const { data, error: e } = await api.GET('/v1/vets/me/documents/{id}/url', {
      params: { path: { id } },
    });
    if (e || !data) return setError(errorText(lang, e));
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  async function updateDetails() {
    const { error: e } = await api.POST('/v1/vets/me/application/new-version');
    if (e) return setError(errorText(lang, e));
    router.push('/vet/application');
  }

  const q = profile.qualifications;
  const toggle = <T extends string>(list: T[], x: T, on: boolean) =>
    on ? [...list, x] : list.filter((y) => y !== x);

  return (
    <Shell title={vp.title} role="vet" nav={<VetNav />}>
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-4">
          <PersonAvatar url={me.photo.url} name={me.name} size={88} />
          <div className="space-y-1">
            <p className="text-xl font-bold">{me.name}</p>
            {me.displayName && <p className="text-muted">“{me.displayName}”</p>}
            <p>
              {profile.type === 'vet'
                ? t.web.onboarding.vetTypeVet
                : t.web.onboarding.vetTypeParavet}{' '}
              {profile.verificationStatus === 'approved' && <Badge tone="success">✓</Badge>}
            </p>
            {profile.rating !== null && <p>★ {profile.rating.toFixed(1)}</p>}
            <BadgeChips badges={profile.badges} />
            <Link href="/settings" className="text-sm underline">
              {vp.editPhoto}
            </Link>
          </div>
        </Card>

        {profile.practiceMissing.length > 0 && (
          <Notice tone="warning">
            {vp.incomplete} {profile.practiceMissing.map(fieldLabel).join(', ')}
          </Notice>
        )}

        <Card className="space-y-4">
          <h2 className="text-lg font-bold">{vp.practice}</h2>
          <Field
            label={t.web.application.fields.consultationFee}
            hint={`${p.consultationHint} ${
              profile.bands.items.consultation
                ? fmt(p.band, {
                    min: profile.bands.items.consultation.min,
                    max: profile.bands.items.consultation.max,
                  })
                : ''
            }`}
          >
            <Input
              type="number"
              inputMode="numeric"
              value={v.consultationFee ?? ''}
              onChange={(e) =>
                set({ consultationFee: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t.web.application.fields.services}</legend>
            <div className="flex flex-wrap gap-2">
              {VET_SERVICES.map((s) => (
                <label
                  key={s}
                  className={`flex min-h-touch items-center gap-2 rounded-full border px-3 ${v.services.includes(s) ? 'border-brand bg-brand-light' : 'border-line'}`}
                >
                  <input
                    type="checkbox"
                    checked={v.services.includes(s)}
                    onChange={(e) => set({ services: toggle(v.services, s, e.target.checked) })}
                  />
                  {t.web.application.services[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-semibold">{p.services}</legend>
            <FeesEditor
              services={v.services}
              value={v.serviceFees}
              onChange={(serviceFees) => set({ serviceFees })}
              bands={profile.bands.items}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t.web.application.fields.species}</legend>
            <div className="flex flex-wrap gap-2">
              {SPECIES.map((s) => (
                <label key={s} className="flex min-h-touch items-center gap-2">
                  <input
                    type="checkbox"
                    checked={v.specialties.includes(s)}
                    onChange={(e) =>
                      set({ specialties: toggle<Species>(v.specialties, s, e.target.checked) })
                    }
                  />
                  {t.ussd.species[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-touch items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={v.offersCallOuts}
              onChange={(e) => set({ offersCallOuts: e.target.checked })}
            />
            {vp.callOuts}
          </label>
          {v.offersCallOuts && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t.web.application.fields.baseCallOutFee}
                hint={fmt(p.band, {
                  min: profile.bands.callOut.min,
                  max: profile.bands.callOut.max,
                })}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  value={v.baseCallOutFee ?? ''}
                  onChange={(e) =>
                    set({ baseCallOutFee: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label={t.web.application.fields.serviceRadiusKm}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={v.serviceRadiusKm}
                  onChange={(e) => set({ serviceRadiusKm: Number(e.target.value) })}
                />
              </Field>
            </div>
          )}
          <label className="flex min-h-touch items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={v.hasPremises}
              onChange={(e) => set({ hasPremises: e.target.checked })}
            />
            {vp.premises}
          </label>
          {v.hasPremises && (
            <div className="space-y-3">
              <p className="font-semibold">{vp.premisesWard}</p>
              <WardPicker
                value={v.premisesWard?.id ?? null}
                onChange={(id) =>
                  set({ premisesWard: { id, ward: '', subCounty: '', county: '' } })
                }
              />
              <Field label={vp.premisesDirections}>
                <Input
                  value={v.premisesDirections ?? ''}
                  maxLength={200}
                  onChange={(e) => set({ premisesDirections: e.target.value || null })}
                />
              </Field>
              <Field label={vp.premisesHours}>
                <Input
                  value={v.premisesHours ?? ''}
                  maxLength={100}
                  onChange={(e) => set({ premisesHours: e.target.value || null })}
                />
              </Field>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t.web.hours.title}</legend>
            <HoursEditor
              value={(v.workingHours ?? DEFAULT_WORKING_HOURS) as WorkingHours}
              onChange={(workingHours) => set({ workingHours })}
            />
          </fieldset>
          <ErrorBox message={error} />
          {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
          <Button disabled={Object.keys(draft).length === 0} onClick={() => void save()}>
            {t.web.common.save}
          </Button>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold">{vp.qualifications}</h2>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {(
              [
                [t.web.application.fields.kvbRegNo, q.kvbRegNo],
                [
                  t.web.application.fields.kvbCategory,
                  q.kvbCategory && t.web.application.kvbCategories[q.kvbCategory],
                ],
                [t.web.application.fields.licenceExpiry, q.licenceExpiry],
                [t.web.application.fields.qualification, q.qualification],
                [t.web.application.fields.institution, q.institution],
                [t.web.application.fields.yearQualified, q.yearQualified],
                [
                  t.web.application.fields.practiceType,
                  q.practiceType && t.web.application.practiceTypes[q.practiceType],
                ],
                [t.web.application.fields.practiceName, q.practiceName],
                [t.web.application.fields.yearsExperience, q.yearsExperience],
                [
                  t.web.application.fields.languages,
                  q.languages.map((l) => t.web.application.languageNames[l]).join(', '),
                ],
                [vp.nationalId, q.nationalIdLast3 && `…${q.nationalIdLast3}`],
              ] as const
            )
              .filter(([, val]) => val !== null && val !== '')
              .map(([label, val]) => (
                <div key={label}>
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd>{String(val)}</dd>
                </div>
              ))}
          </dl>
          {q.bio && <p className="italic">{q.bio}</p>}
          {q.verifiedAt && (
            <p className="text-sm text-muted">
              {fmt(vp.verifiedOn, { date: new Date(q.verifiedAt).toLocaleDateString(lang) })}
            </p>
          )}
          <p className="text-sm text-muted">{vp.criticalHint}</p>
          <Button variant="secondary" onClick={() => void updateDetails()}>
            {vp.updateDetails}
          </Button>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold">{vp.documents}</h2>
          <ul className="divide-y divide-line">
            {profile.documents.map((d) => (
              <li key={d.id} className="flex min-h-touch items-center gap-3 py-2">
                <span className="flex-1">{t.web.application.docKinds[d.kind]}</span>
                {d.expiresAt && <span className="text-sm text-muted">{d.expiresAt}</span>}
                <Button variant="secondary" onClick={() => void openDoc(d.id)}>
                  {vp.open}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
