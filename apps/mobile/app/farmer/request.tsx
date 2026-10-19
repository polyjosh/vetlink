import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
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
import { PriceRangeLines } from '../../src/components/prices';
import { Screen } from '../../src/components/screen';
import {
  Badge,
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Notice,
  P,
} from '../../src/components/ui';
import { WardPicker } from '../../src/components/ward-picker';
import { enablePush } from '../../src/lib/push';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api } from '../../src/lib/session';

type Place =
  | { kind: 'saved' }
  | { kind: 'ward'; wardId: number | null }
  | { kind: 'gps'; lat: number; lng: number };

/** Request flow (§8.2): animal, problem, place, fee and deposit, pay. Same rules as USSD and web. */
export default function Request() {
  const { t, fmt, err } = useT();
  const emergency = useLocalSearchParams<{ emergency?: string }>().emergency === '1';
  const animals = useApi(['animals'], () => api.GET('/v1/animals'), { cache: 'animals' });
  const farm = useApi(['farmer-profile'], () => api.GET('/v1/farmers/me'), {
    cache: 'farmer:profile',
  });
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [species, setSpecies] = useState<Species | null>(null);
  const [problem, setProblem] = useState<ProblemType | null>(emergency ? 'sick' : null);
  // Added to the consultation (§24.3); the problem pre-ticks the obvious one.
  const [services, setServices] = useState<VetService[]>([]);
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
        },
      });
      if (!data) {
        setError(err(e));
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

  return (
    <Screen title={emergency ? r.emergencyTitle : r.title} role="farmer">
      {emergency && <Badge tone="danger">{r.emergencyBadge}</Badge>}
      <Card>
        <H2>{r.chooseAnimal}</H2>
        {(animals.data?.length ?? 0) > 0 && (
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
        )}
        <P muted>{r.orSpecies}</P>
        <Choices
          options={SPECIES.map((x) => ({ value: x, label: t.ussd.species[x] }))}
          value={animalId ? null : species}
          onChange={(v) => {
            setSpecies(v);
            setAnimalId(null);
          }}
        />
      </Card>
      {!emergency && (
        <Card>
          <H2>{r.problem}</H2>
          <Choices
            options={PROBLEM_TYPES.map((p) => ({ value: p, label: t.ussd.problems[p] }))}
            value={problem}
            onChange={(p) => {
              setProblem(p);
              setServices(servicesForProblem(p));
            }}
          />
        </Card>
      )}
      {!emergency && (
        <Card>
          <H2>{t.web.prices.addServices}</H2>
          <P muted>{t.web.prices.addServicesHint}</P>
          <Choices
            multi
            options={VET_SERVICES.map((x) => ({ value: x, label: t.web.application.services[x] }))}
            value={services}
            onChange={(x) =>
              setServices(services.includes(x) ? services.filter((y) => y !== x) : [...services, x])
            }
          />
        </Card>
      )}
      <Card>
        <Field
          label={r.note}
          placeholder={r.noteHint}
          multiline
          maxLength={500}
          value={note}
          onChangeText={setNote}
        />
      </Card>
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
      <Card>
        <H2>{r.review}</H2>
        {quote.data ? (
          <PriceRangeLines range={quote.data.priceRange} bookingFee={quote.data.depositKes} />
        ) : (
          <P>…</P>
        )}
        <Notice>{r.depositHint}</Notice>
      </Card>
      <ErrorText message={error} />
      <Button
        big
        variant={emergency ? 'danger' : 'primary'}
        title={fmt(r.confirmPay, { amount: quote.data?.depositKes ?? '…' })}
        disabled={busy || !chosenSpecies || !problem || !placeReady || !quote.data}
        onPress={() => void submit()}
        testID="confirm-pay"
      />
    </Screen>
  );
}
