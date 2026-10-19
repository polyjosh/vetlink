'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  PROBLEM_TYPES,
  SPECIES,
  VET_SERVICES,
  servicesForProblem,
  type ProblemType,
  type Species,
  type VetService,
} from '@vetlink/shared';
import { newIdempotencyKey, type Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { PriceRangeLines } from '@/components/prices';
import { Shell } from '@/components/shell';
import {
  Badge,
  Button,
  Card,
  ChoiceGrid,
  ErrorBox,
  Field,
  Notice,
  TextArea,
} from '@/components/ui';
import { WardPicker } from '@/components/ward-picker';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Location =
  | { kind: 'saved' }
  | { kind: 'ward'; wardId: number | null }
  | { kind: 'gps'; lat: number; lng: number };

/** Request flow (§8.2): animal, problem, location, review fee + deposit, pay, then tracking. */
function RequestFlow() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const router = useRouter();
  const isEmergency = useSearchParams().get('emergency') === '1';
  const [animals, setAnimals] = useState<Schemas['Animal'][]>([]);
  const [farm, setFarm] = useState<Schemas['FarmerProfile'] | null>(null);
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [species, setSpecies] = useState<Species | null>(null);
  const [problem, setProblem] = useState<ProblemType | null>(isEmergency ? 'sick' : null);
  // Added to the consultation (§24.3); the problem pre-ticks the obvious one.
  const [services, setServices] = useState<VetService[]>([]);
  const [note, setNote] = useState('');
  const [location, setLocation] = useState<Location>({ kind: 'saved' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per request, made on the first tap and reused on every retry (§10).
  const key = useRef<string | null>(null);

  useEffect(() => {
    void api.GET('/v1/animals').then(({ data }) => setAnimals(data ?? []));
    void api.GET('/v1/farmers/me').then(({ data }) => {
      setFarm(data ?? null);
      if (!data?.ward) setLocation({ kind: 'ward', wardId: null });
    });
  }, [api]);

  const chosenSpecies = animalId
    ? (animals.find((a) => a.id === animalId)?.species ?? null)
    : species;

  // The fee is quoted by the server before the farmer commits (§8.6). A quote belongs to the
  // exact query it answered, so a changed animal or place shows no fee until the new one arrives.
  const wardForQuote = location.kind === 'ward' ? location.wardId : null;
  const quoteKey =
    chosenSpecies && !(location.kind === 'ward' && !wardForQuote)
      ? JSON.stringify({
          species: chosenSpecies,
          ...(wardForQuote && { wardId: wardForQuote }),
          ...(location.kind === 'gps' && { lat: location.lat, lng: location.lng }),
          ...(services.length && { services: services.join(',') }),
        })
      : null;
  const [quote, setQuote] = useState<{ key: string; data: Schemas['Quote'] } | null>(null);
  const current = quote && quote.key === quoteKey ? quote.data : null;
  useEffect(() => {
    if (!quoteKey) return;
    const query = JSON.parse(quoteKey) as {
      species: Species;
      wardId?: number;
      lat?: number;
      lng?: number;
      services?: string;
    };
    void api.GET('/v1/bookings/quote', { params: { query } }).then(({ data }) => {
      if (data) setQuote({ key: quoteKey, data });
    });
  }, [api, quoteKey]);

  async function submit() {
    if (!chosenSpecies || !problem) return;
    key.current ??= newIdempotencyKey();
    setBusy(true);
    setError(null);
    const { data, error: e } = await api.POST('/v1/bookings', {
      params: { header: { 'idempotency-key': key.current } },
      body: {
        species: chosenSpecies,
        problemType: problem,
        isEmergency,
        ...(services.length && { services }),
        ...(animalId && { animalId }),
        ...(note.trim() && { note: note.trim() }),
        ...(location.kind === 'ward' && location.wardId && { wardId: location.wardId }),
        ...(location.kind === 'gps' && { lat: location.lat, lng: location.lng }),
      },
    });
    if (e || !data) {
      setBusy(false);
      setError(errorText(lang, e));
      return;
    }
    const pay = await api.POST('/v1/payments/stk', { body: { bookingId: data.id } });
    setBusy(false);
    if (pay.error) {
      // The booking exists; the tracking page offers "pay again".
      setError(errorText(lang, pay.error));
    }
    router.replace(`/farmer/bookings/${data.id}`);
  }

  const ready =
    chosenSpecies && problem && current !== null && (location.kind !== 'ward' || location.wardId);

  return (
    <Shell
      title={isEmergency ? t.web.request.emergencyTitle : t.web.request.title}
      role="farmer"
      nav={<FarmerNav />}
    >
      <div className="space-y-6">
        {isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t.web.request.chooseAnimal}</h2>
          {animals.length > 0 && (
            <ChoiceGrid
              options={animals.map((a) => ({
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
          <p className="text-sm text-muted">{t.web.request.orSpecies}</p>
          <ChoiceGrid
            options={SPECIES.map((s) => ({ value: s, label: t.ussd.species[s] }))}
            value={animalId ? null : species}
            onChange={(v) => {
              setSpecies(v);
              setAnimalId(null);
            }}
          />
        </Card>
        {!isEmergency && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{t.web.request.problem}</h2>
            <ChoiceGrid
              options={PROBLEM_TYPES.map((p) => ({ value: p, label: t.ussd.problems[p] }))}
              value={problem}
              onChange={(p) => {
                setProblem(p);
                setServices(servicesForProblem(p));
              }}
            />
          </Card>
        )}
        {!isEmergency && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{t.web.prices.addServices}</h2>
            <p className="text-sm text-muted">{t.web.prices.addServicesHint}</p>
            <div className="flex flex-wrap gap-2">
              {VET_SERVICES.map((s) => (
                <label
                  key={s}
                  className={`flex min-h-touch items-center gap-2 rounded-full border px-3 ${services.includes(s) ? 'border-brand bg-brand-light' : 'border-line'}`}
                >
                  <input
                    type="checkbox"
                    checked={services.includes(s)}
                    onChange={(e) =>
                      setServices(
                        e.target.checked ? [...services, s] : services.filter((x) => x !== s),
                      )
                    }
                  />
                  {t.web.application.services[s]}
                </label>
              ))}
            </div>
          </Card>
        )}
        <Card className="space-y-3">
          <Field label={t.web.request.note}>
            <TextArea
              rows={2}
              maxLength={500}
              placeholder={t.web.request.noteHint}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t.web.request.location}</h2>
          <ChoiceGrid
            options={[
              ...(farm?.ward
                ? [
                    {
                      value: 'saved' as const,
                      label: fmt(t.web.request.savedWard, { ward: farm.ward.ward }),
                    },
                  ]
                : []),
              { value: 'ward' as const, label: t.web.request.otherWard },
              {
                value: 'gps' as const,
                label: location.kind === 'gps' ? t.web.request.gpsSet : t.web.request.useGps,
              },
            ]}
            value={location.kind}
            onChange={(kind) => {
              if (kind === 'saved') setLocation({ kind });
              if (kind === 'ward') setLocation({ kind, wardId: null });
              if (kind === 'gps') {
                navigator.geolocation.getCurrentPosition(
                  (p) =>
                    setLocation({ kind: 'gps', lat: p.coords.latitude, lng: p.coords.longitude }),
                  () => {
                    setError(t.web.request.gpsDenied);
                    setLocation({ kind: 'ward', wardId: null });
                  },
                  { enableHighAccuracy: true, timeout: 15_000 },
                );
              }
            }}
          />
          {location.kind === 'ward' && (
            <WardPicker
              value={location.wardId}
              onChange={(wardId) => setLocation({ kind: 'ward', wardId })}
            />
          )}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-bold">{t.web.request.review}</h2>
          {current ? (
            <PriceRangeLines range={current.priceRange} bookingFee={current.depositKes} />
          ) : (
            <p>…</p>
          )}
          <Notice>{t.web.request.depositHint}</Notice>
        </Card>
        <ErrorBox message={error} />
        <Button
          className="w-full py-4 text-lg"
          variant={isEmergency ? 'danger' : 'primary'}
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {fmt(t.web.request.confirmPay, { amount: current?.depositKes ?? '…' })}
        </Button>
      </div>
    </Shell>
  );
}

export default function RequestPage() {
  return (
    <Suspense>
      <RequestFlow />
    </Suspense>
  );
}
