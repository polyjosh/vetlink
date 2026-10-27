'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  BOOKING_PHOTOS_MAX,
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
import { PriceLines, PriceRangeLines } from '@/components/prices';
import { ClinicList, VetChooser, type VetSort } from '@/components/vet-chooser';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceGrid,
  ChoiceTile,
  ErrorBox,
  Field,
  Icon,
  Notice,
  TextArea,
} from '@/components/ui';
import { WardPicker } from '@/components/ward-picker';
import { preparePhoto } from '@/lib/photo';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { WhenPicker, type When } from '@/components/when-picker';

type Location =
  | { kind: 'saved' }
  | { kind: 'ward'; wardId: number | null }
  | { kind: 'gps'; lat: number; lng: number };

/** Request flow (§8.2): animal, problem, location, review fee + deposit, pay, then tracking. */
function RequestFlow() {
  const { t, alt, fmt, lang } = useT();
  const { api } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  // Emergency comes from the link or the "How urgent?" choice; it sets the same flag.
  const [isEmergency, setEmergency] = useState(params.get('emergency') === '1');
  const [step, setStep] = useState<1 | 2>(1);
  // "Book again" and follow-up links prefill the vet and animal (§24.9).
  const againVet = params.get('vet');
  const followUp = Number(params.get('followUp')) || null;
  const [animals, setAnimals] = useState<Schemas['Animal'][]>([]);
  const [farm, setFarm] = useState<Schemas['FarmerProfile'] | null>(null);
  const [animalId, setAnimalId] = useState<string | null>(params.get('animal'));
  const [photos, setPhotos] = useState<File[]>([]);
  const [species, setSpecies] = useState<Species | null>(null);
  const [problem, setProblem] = useState<ProblemType | null>(
    params.get('emergency') === '1' ? 'sick' : null,
  );
  // Added to the consultation (§24.3); the problem pre-ticks the obvious one.
  const [services, setServices] = useState<VetService[]>([]);
  // §24.6: a vet id, or 'auto' for fastest available (always auto in an emergency).
  const [choice, setChoice] = useState<string | null>(
    params.get('emergency') === '1' ? 'auto' : againVet,
  );

  function setUrgency(emergency: boolean) {
    setEmergency(emergency);
    // As the emergency link does: fastest available vet, and "sick" unless a problem is chosen.
    if (emergency) {
      setChoice('auto');
      setWhen({ kind: 'asap' });
      if (!problem) setProblem('sick');
    } else if (choice === 'auto') setChoice(againVet);
  }
  const [sort, setSort] = useState<VetSort>('distance');
  const [when, setWhen] = useState<When>({ kind: 'asap' });
  const [clinics, setClinics] = useState<Schemas['Clinic'][]>([]);
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
      else
        void api
          .GET('/v1/vets/clinics', { params: { query: {} } })
          .then((c) => setClinics(c.data ?? []));
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

  // The vets to choose from, for the same request (§24.6). Not for emergencies.
  const whenKey = when.kind === 'later' ? `${when.date}|${when.part}` : 'asap';
  const listKey = !isEmergency && quoteKey ? `${quoteKey}|${sort}|${whenKey}` : null;
  const [list, setList] = useState<{ key: string; vets: Schemas['ChoosableVet'][] } | null>(null);
  const vets = list && list.key === listKey ? list.vets : null;
  useEffect(() => {
    if (!listKey || !quoteKey) return;
    const query = {
      ...(JSON.parse(quoteKey) as { species: Species }),
      sort,
      ...(when.kind === 'later' && { date: when.date, part: when.part }),
    };
    void api.GET('/v1/vets/choose', { params: { query } }).then(({ data }) => {
      if (data) setList({ key: listKey, vets: data });
    });
  }, [api, listKey, quoteKey, sort, when]);
  const chosenVet = vets?.find((v) => v.vetId === choice) ?? null;

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
        ...(chosenVet && { dispatchMode: 'chosen' as const, vetId: chosenVet.vetId }),
        ...(followUp && { followUpOfTreatmentId: followUp }),
        ...(chosenVet &&
          when.kind === 'later' && { schedule: { date: when.date, part: when.part } }),
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
    // Photos are optional and go up once the request exists (§24.15); a failure keeps the request.
    for (const file of photos) {
      try {
        const blob = await preparePhoto(file, 'booking_photo');
        const p = await api.POST('/v1/uploads/presign', {
          body: {
            purpose: 'photo',
            photoKind: 'booking_photo',
            contentType: 'image/jpeg',
            size: blob.size,
          },
        });
        if (!p.data) break;
        const put = await fetch(p.data.uploadUrl, {
          method: 'PUT',
          headers: p.data.headers,
          body: blob,
        });
        if (!put.ok) break;
        await api.PUT('/v1/bookings/{id}/photos', {
          params: { path: { id: data.id } },
          body: { storageKey: p.data.storageKey },
        });
      } catch {
        break;
      }
    }
    if (chosenVet) {
      // The booking fee is asked for only once the vet accepts (§24.6).
      setBusy(false);
      router.replace(`/farmer/bookings/${data.id}`);
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
    chosenSpecies &&
    problem &&
    current !== null &&
    (choice === 'auto' || !!chosenVet) &&
    (location.kind !== 'ward' || location.wardId);

  const step1Ready = !!chosenSpecies && !!problem;
  const summary = step1Ready
    ? [
        fmt(t.web.request.summary, {
          animal: t.ussd.species[chosenSpecies],
          problem: t.ussd.problems[problem],
        }),
        isEmergency ? t.web.request.urgent : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t.web.request.summaryEmpty;

  return (
    <Shell
      title={isEmergency ? t.web.request.emergencyTitle : t.web.request.title}
      subtitle={`${fmt(t.web.ui.stepOf, { n: step, total: 2 })} · ${step === 1 ? t.web.request.stepAnimal : t.web.request.stepVisit}`}
      role="farmer"
      nav={<FarmerNav />}
    >
      <div
        className="-mt-3 mb-6 grid grid-cols-2 gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={step}
        aria-label={fmt(t.web.ui.stepOf, { n: step, total: 2 })}
      >
        <span className="h-progress rounded-full bg-primary" />
        <span className={`h-progress rounded-full ${step === 2 ? 'bg-primary' : 'bg-border'}`} />
      </div>
      <div className="space-y-7 pb-4">
        {step === 1 ? (
          <>
            <section className="space-y-3">
              <h2 className="text-button">{t.web.request.chooseAnimal}</h2>
              {animals.length > 0 && (
                <>
                  <ChoiceGrid
                    columns={3}
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
                  <p className="text-small text-ink-muted">{t.web.request.orSpecies}</p>
                </>
              )}
              <ChoiceGrid
                columns={3}
                options={SPECIES.map((s) => ({
                  value: s,
                  label: t.ussd.species[s],
                  secondary: alt.ussd.species[s],
                }))}
                value={animalId ? null : species}
                onChange={(v) => {
                  setSpecies(v);
                  setAnimalId(null);
                }}
              />
            </section>
            <section className="space-y-3">
              <h2 className="text-button">{t.web.request.problem}</h2>
              <div className="flex flex-wrap gap-2">
                {PROBLEM_TYPES.map((p) => (
                  <ChoiceChip
                    key={p}
                    selected={problem === p}
                    onClick={() => {
                      setProblem(p);
                      setServices(servicesForProblem(p));
                    }}
                  >
                    {t.ussd.problems[p]}
                  </ChoiceChip>
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-button">{t.web.request.howUrgent}</h2>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceTile
                  label={t.web.request.today}
                  secondary={t.web.request.todayHint}
                  selected={!isEmergency}
                  onClick={() => setUrgency(false)}
                />
                <ChoiceTile
                  label={t.web.request.urgent}
                  secondary={t.web.request.urgentHint}
                  selected={isEmergency}
                  tone="warning"
                  onClick={() => setUrgency(true)}
                />
              </div>
            </section>
            <section className="space-y-4">
              <Field label={t.web.request.note}>
                <TextArea
                  rows={2}
                  maxLength={500}
                  placeholder={t.web.request.noteHint}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <div className="space-y-2">
                <span className="block text-small font-semibold">{t.web.request.photos}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {photos.map((f, i) => (
                    <Button
                      key={i}
                      variant="secondary"
                      icon="image"
                      trailingIcon="close"
                      aria-label={fmt(t.web.request.removePhoto, { n: i + 1 })}
                      onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    >
                      {fmt(t.web.request.photoN, { n: i + 1 })}
                    </Button>
                  ))}
                  {photos.length < BOOKING_PHOTOS_MAX && (
                    <label className="inline-flex min-h-button-md cursor-pointer items-center gap-2 rounded-md border-strong border-border bg-surface px-4 font-bold hover:border-primary">
                      <Icon name="camera" />
                      {t.web.request.addPhoto}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setPhotos([...photos, f]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </section>
            <p className="flex gap-3 rounded-lg border border-border bg-surface p-4 text-small">
              <Icon name="shieldCheck" size={20} className="text-primary" />
              {t.web.request.trustNote}
            </p>
          </>
        ) : (
          <>
            <Card className="space-y-3">
              <h2 className="text-heading">{t.web.request.location}</h2>
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
                        setLocation({
                          kind: 'gps',
                          lat: p.coords.latitude,
                          lng: p.coords.longitude,
                        }),
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
            {!isEmergency && (
              <Card className="space-y-3">
                <h2 className="text-heading">{t.web.prices.addServices}</h2>
                <p className="text-small text-ink-muted">{t.web.prices.addServicesHint}</p>
                <div className="flex flex-wrap gap-2">
                  {VET_SERVICES.map((s) => (
                    <ChoiceChip
                      key={s}
                      selected={services.includes(s)}
                      onClick={() =>
                        setServices(
                          services.includes(s) ? services.filter((x) => x !== s) : [...services, s],
                        )
                      }
                    >
                      {t.web.application.services[s]}
                    </ChoiceChip>
                  ))}
                </div>
              </Card>
            )}
            {!isEmergency && (
              <Card className="space-y-3">
                <h2 className="text-heading">{t.web.schedule.title}</h2>
                <WhenPicker
                  value={when}
                  onChange={(w) => {
                    setWhen(w);
                    // Booking ahead means choosing a vet; "fastest available" is now only.
                    if (w.kind === 'later' && choice === 'auto') setChoice(null);
                  }}
                />
                <h2 className="text-heading">{t.web.choose.title}</h2>
                <VetChooser
                  vets={vets}
                  value={choice}
                  onChange={setChoice}
                  sort={sort}
                  onSort={setSort}
                  showFastest={when.kind === 'asap'}
                />
                <ClinicList clinics={clinics} />
              </Card>
            )}
            <Card className="space-y-2">
              <h2 className="text-heading">{t.web.request.review}</h2>
              {chosenVet ? (
                <>
                  <p className="font-semibold">{chosenVet.name}</p>
                  <PriceLines price={chosenVet.price} />
                  <Notice>{t.web.choose.feeAfterAccept}</Notice>
                </>
              ) : current ? (
                <>
                  <PriceRangeLines range={current.priceRange} bookingFee={current.depositKes} />
                  {current.walletCredit > 0 && (
                    <Notice tone="success">
                      {current.walletCredit >= current.depositKes
                        ? t.web.wallet.covers
                        : fmt(t.web.wallet.partly, {
                            credit: current.walletCredit,
                            rest: current.depositKes - current.walletCredit,
                          })}
                    </Notice>
                  )}
                </>
              ) : (
                <p>…</p>
              )}
              <Notice>{t.web.request.depositHint}</Notice>
            </Card>
            <ErrorBox message={error} />
          </>
        )}
      </div>
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface px-4 py-3 shadow-raised sm:mx-0 sm:rounded-t-lg">
        <p className="mb-2 text-center text-small text-ink-muted" aria-live="polite">
          {summary}
        </p>
        {step === 1 ? (
          <Button
            size="lg"
            className="w-full"
            trailingIcon="chevronRight"
            disabled={!step1Ready}
            onClick={() => {
              setStep(2);
              window.scrollTo({ top: 0 });
            }}
          >
            {t.web.common.continue}
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button size="lg" variant="ghost" icon="chevronLeft" onClick={() => setStep(1)}>
              {t.web.common.back}
            </Button>
            <Button
              size="lg"
              className="flex-1"
              variant={isEmergency ? 'accent' : 'primary'}
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {chosenVet
                ? t.web.choose.sendRequest
                : fmt(t.web.request.confirmPay, { amount: current?.depositKes ?? '…' })}
            </Button>
          </div>
        )}
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
