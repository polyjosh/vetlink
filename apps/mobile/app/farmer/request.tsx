import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { color, layout, nativeShadow, radius, size, space, type } from '@vetlink/ui-tokens';
import { useRef, useState } from 'react';
import {
  PROBLEM_TYPES,
  SPECIES,
  VET_SERVICES,
  servicesForProblem,
  type ProblemType,
  type Species,
  type VetService,
} from '@vetlink/shared';
import { newIdempotencyKey } from '@vetlink/api-client';
import { PriceLines, PriceRangeLines } from '../../src/components/prices';
import { ClinicList, VetChooser, type VetSort } from '../../src/components/vet-chooser';
import { Screen } from '../../src/components/screen';
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceTile,
  Choices,
  ErrorText,
  Field,
  H2,
  Icon,
  Notice,
  P,
  Text,
  s,
} from '../../src/components/ui';
import { WardPicker } from '../../src/components/ward-picker';
import { enablePush } from '../../src/lib/push';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api } from '../../src/lib/session';
import { pickPhoto, uploadPhoto } from '../../src/lib/photo';
import { BOOKING_PHOTOS_MAX } from '@vetlink/shared';
import { WhenPicker, type When } from '../../src/components/when-picker';

type Place =
  | { kind: 'saved' }
  | { kind: 'ward'; wardId: number | null }
  | { kind: 'gps'; lat: number; lng: number };

/** Request flow (§8.2): animal, problem, place, fee and deposit, pay. Same rules as USSD and web. */
export default function Request() {
  const { t, alt, fmt, err } = useT();
  const params = useLocalSearchParams<{
    emergency?: string;
    vet?: string;
    animal?: string;
    followUp?: string;
  }>();
  // Emergency comes from the link or the "How urgent?" choice; it sets the same flag.
  const [emergency, setEmergency] = useState(params.emergency === '1');
  const [step, setStep] = useState<1 | 2>(1);
  // "Book again" and follow-up links prefill the vet and animal (§24.9).
  const followUp = Number(params.followUp) || null;
  const [photos, setPhotos] = useState<{ uri: string; size: number }[]>([]);
  const animals = useApi(['animals'], () => api.GET('/v1/animals'), { cache: 'animals' });
  const farm = useApi(['farmer-profile'], () => api.GET('/v1/farmers/me'), {
    cache: 'farmer:profile',
  });
  const [animalId, setAnimalId] = useState<string | null>(params.animal ?? null);
  const [species, setSpecies] = useState<Species | null>(null);
  const [problem, setProblem] = useState<ProblemType | null>(
    params.emergency === '1' ? 'sick' : null,
  );
  // Added to the consultation (§24.3); the problem pre-ticks the obvious one.
  const [services, setServices] = useState<VetService[]>([]);
  // §24.6: a vet id, or 'auto' for fastest available (always auto in an emergency).
  const [choice, setChoice] = useState<string | null>(
    params.emergency === '1' ? 'auto' : (params.vet ?? null),
  );

  function setUrgency(urgent: boolean) {
    setEmergency(urgent);
    // As the emergency link does: fastest available vet, and "sick" unless a problem is chosen.
    if (urgent) {
      setChoice('auto');
      setWhen({ kind: 'asap' });
      if (!problem) setProblem('sick');
    } else if (choice === 'auto') setChoice(params.vet ?? null);
  }
  const [sort, setSort] = useState<VetSort>('distance');
  const [when, setWhen] = useState<When>({ kind: 'asap' });
  const [note, setNote] = useState('');
  const [chosenPlace, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per request, made on the first tap and reused on every retry (§10).
  const key = useRef<string | null>(null);
  const r = t.web.request;

  const place: Place =
    chosenPlace ?? (farm.data?.ward ? { kind: 'saved' } : { kind: 'ward', wardId: null });
  const chosenSpecies = animalId
    ? (animals.data?.find((a) => a.id === animalId)?.species ?? null)
    : species;
  const wardId = place.kind === 'ward' ? place.wardId : null;
  const placeReady = place.kind !== 'ward' || !!wardId;

  // The fee is quoted by the server before the farmer commits (§8.6).
  const quote = useApi(
    [
      'quote',
      chosenSpecies,
      wardId,
      place.kind === 'gps' ? place.lat : null,
      place.kind === 'gps' ? place.lng : null,
      services.join(','),
    ],
    () =>
      api.GET('/v1/bookings/quote', {
        params: {
          query: {
            species: chosenSpecies ?? 'other',
            ...(wardId && { wardId }),
            ...(place.kind === 'gps' && { lat: place.lat, lng: place.lng }),
            ...(services.length && { services: services.join(',') }),
          },
        },
      }),
    { enabled: !!chosenSpecies && placeReady },
  );

  const query = {
    species: chosenSpecies ?? ('other' as const),
    ...(wardId && { wardId }),
    ...(place.kind === 'gps' && { lat: place.lat, lng: place.lng }),
    ...(services.length && { services: services.join(',') }),
  };
  const slot = when.kind === 'later' ? { date: when.date, part: when.part } : {};
  const vets = useApi(
    ['choose', JSON.stringify(query), sort, JSON.stringify(slot)],
    () => api.GET('/v1/vets/choose', { params: { query: { ...query, sort, ...slot } } }),
    { enabled: !emergency && !!chosenSpecies && placeReady },
  );
  const clinics = useApi(
    ['clinics'],
    () => api.GET('/v1/vets/clinics', { params: { query: {} } }),
    {
      enabled: !emergency && !!farm.data?.ward,
    },
  );
  const chosenVet = vets.data?.find((v) => v.vetId === choice) ?? null;

  async function pickGps() {
    // Asked here, in context; without it the farmer picks a ward (§11).
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setError(r.gpsDenied);
      setPlace({ kind: 'ward', wardId: null });
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setPlace({ kind: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude });
  }

  async function submit() {
    if (!chosenSpecies || !problem) return;
    key.current ??= newIdempotencyKey();
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await api.POST('/v1/bookings', {
        params: { header: { 'idempotency-key': key.current } },
        body: {
          species: chosenSpecies,
          problemType: problem,
          isEmergency: emergency,
          ...(services.length && { services }),
          ...(animalId && { animalId }),
          ...(note.trim() && { note: note.trim() }),
          ...(wardId && { wardId }),
          ...(place.kind === 'gps' && { lat: place.lat, lng: place.lng }),
          ...(chosenVet && { dispatchMode: 'chosen' as const, vetId: chosenVet.vetId }),
          ...(followUp && { followUpOfTreatmentId: followUp }),
          ...(chosenVet &&
            when.kind === 'later' && { schedule: { date: when.date, part: when.part } }),
        },
      });
      if (!data) {
        setError(err(e));
        return;
      }
      // Optional photos go up once the request exists (§24.15); a failure keeps the request.
      for (const photo of photos) {
        const up = await uploadPhoto('booking_photo', photo).catch(() => null);
        if (!up || !('storageKey' in up)) break;
        await api
          .PUT('/v1/bookings/{id}/photos', {
            params: { path: { id: data.id } },
            body: { storageKey: up.storageKey },
          })
          .catch(() => undefined);
      }
      if (chosenVet) {
        // The booking fee is asked for only once the vet accepts (§24.6).
        void enablePush();
        router.replace(`/farmer/bookings/${data.id}`);
        return;
      }
      // The tracking screen offers "pay again" if this fails.
      await api.POST('/v1/payments/stk', { body: { bookingId: data.id } }).catch(() => undefined);
      void enablePush();
      router.replace(`/farmer/bookings/${data.id}`);
    } catch {
      setError(t.web.common.offline); // the same key makes the retry safe
    } finally {
      setBusy(false);
    }
  }

  const step1Ready = !!chosenSpecies && !!problem;
  const summary = step1Ready
    ? [
        fmt(r.summary, {
          animal: t.ussd.species[chosenSpecies],
          problem: t.ussd.problems[problem],
        }),
        emergency ? r.urgent : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : r.summaryEmpty;
  const canPay =
    !busy && step1Ready && placeReady && !!quote.data && (choice === 'auto' || !!chosenVet);

  const footer = (
    <View style={[st.footer, nativeShadow.raised]}>
      <Text style={st.summary} accessibilityLiveRegion="polite">
        {summary}
      </Text>
      {step === 1 ? (
        <Button
          size="lg"
          trailingIcon="chevronRight"
          title={t.web.common.continue}
          disabled={!step1Ready}
          onPress={() => setStep(2)}
          testID="continue"
        />
      ) : (
        <View style={st.footerRow}>
          <Button
            size="lg"
            variant="ghost"
            icon="chevronLeft"
            title={t.web.common.back}
            onPress={() => setStep(1)}
          />
          <View style={{ flex: 1 }}>
            <Button
              size="lg"
              variant={emergency ? 'accent' : 'primary'}
              title={
                chosenVet
                  ? t.web.choose.sendRequest
                  : fmt(r.confirmPay, { amount: quote.data?.depositKes ?? '…' })
              }
              disabled={!canPay}
              onPress={() => void submit()}
              testID="confirm-pay"
            />
          </View>
        </View>
      )}
    </View>
  );

  return (
    <Screen title={emergency ? r.emergencyTitle : r.title} role="farmer" footer={footer}>
      <Text style={st.step}>
        {`${fmt(t.web.ui.stepOf, { n: step, total: 2 })} · ${step === 1 ? r.stepAnimal : r.stepVisit}`}
      </Text>
      <View style={st.progress} accessible={false}>
        <View style={[st.bar, { backgroundColor: color.primary }]} />
        <View style={[st.bar, { backgroundColor: step === 2 ? color.primary : color.border }]} />
      </View>
      {step === 1 ? (
        <>
          <View style={st.section}>
            <Text accessibilityRole="header" style={st.heading}>
              {r.chooseAnimal}
            </Text>
            {(animals.data?.length ?? 0) > 0 && (
              <>
                <Choices
                  options={(animals.data ?? []).map((a) => ({
                    value: a.id,
                    label: `${a.nameOrTag ?? '-'} (${t.ussd.species[a.species]})`,
                  }))}
                  value={animalId}
                  onChange={(v) => {
                    setAnimalId(v);
                    setSpecies(null);
                  }}
                />
                <P muted>{r.orSpecies}</P>
              </>
            )}
            <Choices
              columns={3}
              options={SPECIES.map((x) => ({
                value: x,
                label: t.ussd.species[x],
                secondary: alt.ussd.species[x],
              }))}
              value={animalId ? null : species}
              onChange={(v) => {
                setSpecies(v);
                setAnimalId(null);
              }}
            />
          </View>
          <View style={st.section}>
            <Text accessibilityRole="header" style={st.heading}>
              {r.problem}
            </Text>
            <View style={s.row}>
              {PROBLEM_TYPES.map((p) => (
                <ChoiceChip
                  key={p}
                  label={t.ussd.problems[p]}
                  selected={problem === p}
                  onPress={() => {
                    setProblem(p);
                    setServices(servicesForProblem(p));
                  }}
                />
              ))}
            </View>
          </View>
          <View style={st.section}>
            <Text accessibilityRole="header" style={st.heading}>
              {r.howUrgent}
            </Text>
            <View style={st.pair}>
              <View style={{ flex: 1 }}>
                <ChoiceTile
                  label={r.today}
                  secondary={r.todayHint}
                  selected={!emergency}
                  onPress={() => setUrgency(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <ChoiceTile
                  label={r.urgent}
                  secondary={r.urgentHint}
                  selected={emergency}
                  warning
                  onPress={() => setUrgency(true)}
                  testID="emergency"
                />
              </View>
            </View>
          </View>
          <View style={st.section}>
            <Field
              label={r.note}
              placeholder={r.noteHint}
              multiline
              maxLength={500}
              value={note}
              onChangeText={setNote}
            />
            <Text style={st.label}>{r.photos}</Text>
            <View style={s.row}>
              {photos.map((x, i) => (
                <Button
                  key={x.uri}
                  icon="image"
                  trailingIcon="close"
                  title={fmt(r.photoN, { n: i + 1 })}
                  accessibilityLabel={fmt(r.removePhoto, { n: i + 1 })}
                  variant="secondary"
                  onPress={() => setPhotos(photos.filter((_, j) => j !== i))}
                />
              ))}
              {photos.length < BOOKING_PHOTOS_MAX && (
                <Button
                  icon="camera"
                  title={r.addPhoto}
                  variant="secondary"
                  onPress={async () => {
                    const picked = await pickPhoto('camera', 'booking_photo').catch(() => null);
                    if (picked) setPhotos([...photos, picked]);
                  }}
                />
              )}
            </View>
          </View>
          <Card style={st.trust}>
            <Icon name="shieldCheck" color={color.primary} size={size.iconSm} />
            <Text style={st.trustText}>{r.trustNote}</Text>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <H2>{r.location}</H2>
            <Choices
              options={[
                ...(farm.data?.ward
                  ? [
                      {
                        value: 'saved' as const,
                        label: fmt(r.savedWard, { ward: farm.data.ward.ward }),
                      },
                    ]
                  : []),
                { value: 'ward' as const, label: r.otherWard },
                { value: 'gps' as const, label: place.kind === 'gps' ? r.gpsSet : r.useGps },
              ]}
              value={place.kind}
              onChange={(kind) => {
                if (kind === 'gps') void pickGps();
                else setPlace(kind === 'saved' ? { kind } : { kind, wardId: null });
              }}
            />
            {place.kind === 'ward' && (
              <WardPicker
                value={place.wardId}
                onChange={(id) => setPlace({ kind: 'ward', wardId: id })}
              />
            )}
          </Card>
          {!emergency && (
            <Card>
              <H2>{t.web.prices.addServices}</H2>
              <P muted>{t.web.prices.addServicesHint}</P>
              <View style={s.row}>
                {VET_SERVICES.map((x) => (
                  <ChoiceChip
                    key={x}
                    label={t.web.application.services[x]}
                    selected={services.includes(x)}
                    onPress={() =>
                      setServices(
                        services.includes(x) ? services.filter((y) => y !== x) : [...services, x],
                      )
                    }
                  />
                ))}
              </View>
            </Card>
          )}
          {!emergency && (
            <Card>
              <H2>{t.web.schedule.title}</H2>
              <WhenPicker
                value={when}
                onChange={(w) => {
                  setWhen(w);
                  // Booking ahead means choosing a vet; "fastest available" is now only.
                  if (w.kind === 'later' && choice === 'auto') setChoice(null);
                }}
              />
              <H2>{t.web.choose.title}</H2>
              <VetChooser
                vets={vets.data}
                value={choice}
                onChange={setChoice}
                sort={sort}
                onSort={setSort}
                showFastest={when.kind === 'asap'}
              />
              <ClinicList clinics={clinics.data} />
            </Card>
          )}
          <Card>
            <H2>{r.review}</H2>
            {chosenVet ? (
              <>
                <P>{chosenVet.name ?? ''}</P>
                <PriceLines price={chosenVet.price} />
              </>
            ) : quote.data ? (
              <>
                <PriceRangeLines range={quote.data.priceRange} bookingFee={quote.data.depositKes} />
                {quote.data.walletCredit > 0 && (
                  <Notice tone="success">
                    {quote.data.walletCredit >= quote.data.depositKes
                      ? t.web.wallet.covers
                      : fmt(t.web.wallet.partly, {
                          credit: quote.data.walletCredit,
                          rest: quote.data.depositKes - quote.data.walletCredit,
                        })}
                  </Notice>
                )}
              </>
            ) : (
              <P>…</P>
            )}
            <Notice>{r.depositHint}</Notice>
          </Card>
          <ErrorText message={error} />
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  step: { fontSize: type.small.size, color: color.inkMuted, marginTop: -space[2] },
  progress: { flexDirection: 'row', gap: space[1], marginTop: space[2], marginBottom: space[5] },
  bar: { flex: 1, height: size.progress, borderRadius: radius.pill },
  section: { gap: space[3], marginBottom: space[6] },
  heading: { fontSize: type.button.size, lineHeight: type.button.line, fontWeight: '700' },
  label: { fontSize: type.small.size, fontWeight: '600' },
  pair: { flexDirection: 'row', gap: space[3] },
  trust: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  trustText: { flex: 1, fontSize: type.small.size, lineHeight: type.small.line },
  footer: {
    backgroundColor: color.surface,
    borderTopWidth: size.border,
    borderTopColor: color.border,
    paddingHorizontal: layout.mobileGutter,
    paddingTop: space[3],
    paddingBottom: space[4],
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  summary: { textAlign: 'center', fontSize: type.small.size, color: color.inkMuted },
});
