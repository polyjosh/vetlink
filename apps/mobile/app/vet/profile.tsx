import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import {
  DEFAULT_WORKING_HOURS,
  SPECIES,
  VET_SERVICES,
  type VetService,
  type WorkingHours,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { colors } from '@vetlink/ui-tokens';
import { PersonAvatar } from '../../src/components/pictures';
import { FeesEditor, HoursEditor } from '../../src/components/prices';
import { Screen } from '../../src/components/screen';
import {
  Badge,
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
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';
import { BadgeChips } from '../../src/components/ratings';

type Profile = Schemas['VetProfile'];

/** The vet's own profile (§24.3): practice and prices, qualifications, documents. */
export default function VetProfileScreen() {
  const { t, fmt, err, lang } = useT();
  const { me } = useSession();
  const q = useApi(['vet-profile'], () => api.GET('/v1/vets/me'), { cache: 'vet:profile' });
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const vp = t.web.vetProfile;
  const p = t.web.prices;
  const profile = q.data;
  if (!profile || !me) return <Loading label={t.web.common.loading} />;
  const v = { ...profile, ...draft };
  const set = (patch: Partial<Profile>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  const fieldLabel = (f: string) => {
    const [name = f, service] = f.split('.');
    if (service) return t.web.application.services[service as VetService];
    return (t.web.application.fields as Record<string, string>)[name] ?? name;
  };
  const toggle = <T extends string>(list: T[], x: T) =>
    list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
  const int = (x: string) => (x.replace(/\D/g, '') === '' ? null : Number(x.replace(/\D/g, '')));

  async function save() {
    setError(null);
    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(draft)) {
      if (k === 'premisesWard') body.premisesWardId = (val as Profile['premisesWard'])?.id ?? null;
      else body[k] = val;
    }
    try {
      const { data, error: e } = await api.PATCH('/v1/vets/me/profile', { body: body as never });
      if (e || !data) {
        const fields = (e as { details?: { fields?: string[] } } | undefined)?.details?.fields;
        return setError(
          fields?.length ? `${err(e)} (${fields.map(fieldLabel).join(', ')})` : err(e),
        );
      }
      setDraft({});
      setSaved(true);
      await q.refetch();
    } catch {
      setError(t.web.common.offline);
    }
  }

  async function openDoc(id: number) {
    const { data, error: e } = await api
      .GET('/v1/vets/me/documents/{id}/url', { params: { path: { id } } })
      .catch(() => ({ data: undefined, error: { code: 'internal_error' } }));
    if (!data) return setError(err(e));
    await Linking.openURL(data.url);
  }

  const qual = profile.qualifications;
  const rows: [string, string | number | null][] = [
    [t.web.application.fields.kvbRegNo, qual.kvbRegNo],
    [
      t.web.application.fields.kvbCategory,
      qual.kvbCategory && t.web.application.kvbCategories[qual.kvbCategory],
    ],
    [t.web.application.fields.licenceExpiry, qual.licenceExpiry],
    [t.web.application.fields.qualification, qual.qualification],
    [t.web.application.fields.institution, qual.institution],
    [t.web.application.fields.yearQualified, qual.yearQualified],
    [t.web.application.fields.yearsExperience, qual.yearsExperience],
    [vp.nationalId, qual.nationalIdLast3 && `…${qual.nationalIdLast3}`],
  ];

  return (
    <Screen
      title={vp.title}
      role="vet"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <Card>
        <View style={s.row}>
          <PersonAvatar url={me.photo.url} name={me.name} size={80} />
          <View style={{ flex: 1 }}>
            <H2>{me.name ?? '-'}</H2>
            {me.displayName && <P muted>{`“${me.displayName}”`}</P>}
            <View style={s.row}>
              <P>
                {profile.type === 'vet'
                  ? t.web.onboarding.vetTypeVet
                  : t.web.onboarding.vetTypeParavet}
              </P>
              {profile.verificationStatus === 'approved' && <Badge tone="success">✓</Badge>}
            </View>
            {profile.rating !== null && <P>{`★ ${profile.rating.toFixed(1)}`}</P>}
            <BadgeChips badges={profile.badges ?? []} />
          </View>
        </View>
        <Button title={vp.editPhoto} variant="ghost" onPress={() => router.push('/settings')} />
      </Card>

      {profile.practiceMissing.length > 0 && (
        <Notice tone="warning">{`${vp.incomplete} ${profile.practiceMissing.map(fieldLabel).join(', ')}`}</Notice>
      )}

      <Card>
        <H2>{vp.practice}</H2>
        <Field
          label={t.web.application.fields.consultationFee}
          hint={p.consultationHint}
          keyboardType="number-pad"
          value={v.consultationFee === null ? '' : String(v.consultationFee)}
          onChangeText={(x) => set({ consultationFee: int(x) })}
        />
        <P>{t.web.application.fields.services}</P>
        <Choices
          multi
          options={VET_SERVICES.map((x) => ({ value: x, label: t.web.application.services[x] }))}
          value={v.services}
          onChange={(x) => set({ services: toggle(v.services, x) })}
        />
        <P>{p.services}</P>
        <FeesEditor
          services={v.services}
          value={v.serviceFees}
          onChange={(serviceFees) => set({ serviceFees })}
          bands={profile.bands.items}
        />
        <P>{t.web.application.fields.species}</P>
        <Choices
          multi
          options={SPECIES.map((x) => ({ value: x, label: t.ussd.species[x] }))}
          value={v.specialties}
          onChange={(x) => set({ specialties: toggle(v.specialties, x) })}
        />
        <View style={[s.row, { minHeight: 48 }]}>
          <Switch
            value={v.offersCallOuts}
            onValueChange={(x) => set({ offersCallOuts: x })}
            trackColor={{ true: colors.brand }}
            accessibilityLabel={vp.callOuts}
          />
          <P>{vp.callOuts}</P>
        </View>
        {v.offersCallOuts && (
          <>
            <Field
              label={t.web.application.fields.baseCallOutFee}
              hint={fmt(p.band, { min: profile.bands.callOut.min, max: profile.bands.callOut.max })}
              keyboardType="number-pad"
              value={v.baseCallOutFee === null ? '' : String(v.baseCallOutFee)}
              onChangeText={(x) => set({ baseCallOutFee: int(x) })}
            />
            <Field
              label={t.web.application.fields.serviceRadiusKm}
              keyboardType="number-pad"
              value={String(v.serviceRadiusKm)}
              onChangeText={(x) => set({ serviceRadiusKm: int(x) ?? 0 })}
            />
          </>
        )}
        <View style={[s.row, { minHeight: 48 }]}>
          <Switch
            value={v.hasPremises}
            onValueChange={(x) => set({ hasPremises: x })}
            trackColor={{ true: colors.brand }}
            accessibilityLabel={vp.premises}
          />
          <P>{vp.premises}</P>
        </View>
        {v.hasPremises && (
          <>
            <P>{vp.premisesWard}</P>
            <WardPicker
              value={v.premisesWard?.id ?? null}
              onChange={(id) => set({ premisesWard: { id, ward: '', subCounty: '', county: '' } })}
            />
            <Field
              label={vp.premisesDirections}
              maxLength={200}
              value={v.premisesDirections ?? ''}
              onChangeText={(x) => set({ premisesDirections: x || null })}
            />
            <Field
              label={vp.premisesHours}
              maxLength={100}
              value={v.premisesHours ?? ''}
              onChangeText={(x) => set({ premisesHours: x || null })}
            />
          </>
        )}
        <P>{t.web.hours.title}</P>
        <HoursEditor
          value={(v.workingHours ?? DEFAULT_WORKING_HOURS) as WorkingHours}
          onChange={(workingHours) => set({ workingHours })}
        />
        <ErrorText message={error} />
        {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
        <Button
          title={t.web.common.save}
          disabled={Object.keys(draft).length === 0}
          onPress={() => void save()}
        />
      </Card>

      <Card>
        <H2>{vp.qualifications}</H2>
        {rows
          .filter(([, val]) => val !== null && val !== '')
          .map(([label, val]) => (
            <P key={label}>{`${label}: ${String(val)}`}</P>
          ))}
        {qual.verifiedAt && (
          <P muted>
            {fmt(vp.verifiedOn, { date: new Date(qual.verifiedAt).toLocaleDateString(lang) })}
          </P>
        )}
        <P muted>{vp.criticalHint}</P>
        <Button
          title={vp.updateDetails}
          variant="secondary"
          onPress={async () => {
            const { error: e } = await api
              .POST('/v1/vets/me/application/new-version')
              .catch(() => ({ error: { code: 'internal_error' } }));
            if (e) return setError(err(e));
            router.push('/vet/application');
          }}
        />
      </Card>

      <Card>
        <H2>{vp.documents}</H2>
        {profile.documents.map((d) => (
          <View key={d.id} style={s.row}>
            <P>{t.web.application.docKinds[d.kind]}</P>
            <Button title={vp.open} variant="secondary" onPress={() => void openDoc(d.id)} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
