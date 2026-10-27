'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ANIMAL_SEXES, type AnimalSex } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { AnimalPicture } from '@/components/pictures';
import { PhotoUpload } from '@/components/photo-upload';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** One animal: photo (or species picture), details, and its visits. */
export default function AnimalHistory() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [h, setH] = useState<Schemas['AnimalHistory'] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [sex, setSex] = useState<AnimalSex | ''>('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/animals/{id}/history', { params: { path: { id } } });
    setH(data ?? null);
  }, [api, id]);
  useLoad(load);
  if (!h) return <Spinner label={t.web.common.loading} />;
  const a = h.animal;
  const setAnimal = (animal: Schemas['Animal']) => setH({ ...h, animal });

  function startEdit() {
    setName(a.nameOrTag ?? '');
    setBreed(a.breed ?? '');
    setSex(a.sex ?? '');
    setDob(a.dob ?? '');
    setEditing(true);
  }

  async function save() {
    setError(null);
    const { data, error: e } = await api.PATCH('/v1/animals/{id}', {
      params: { path: { id } },
      body: {
        nameOrTag: name.trim() || null,
        breed: breed.trim() || null,
        sex: sex || null,
        dob: dob || null,
      },
    });
    if (e || !data) return setError(errorText(lang, e));
    setAnimal(data);
    setEditing(false);
  }

  return (
    <Shell title={a.nameOrTag ?? t.ussd.species[a.species]} role="farmer" nav={<FarmerNav />}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <AnimalPicture url={a.photoUrl} species={a.species} size={112} />
            <div className="space-y-1">
              <p className="font-bold">{t.ussd.species[a.species]}</p>
              {a.breed && <p className="text-muted">{a.breed}</p>}
              {a.sex && <p className="text-muted">{t.web.animals[a.sex]}</p>}
              {a.dob && (
                <p className="text-muted">
                  {t.web.animals.dob}: {new Date(a.dob).toLocaleDateString(lang)}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <PhotoUpload
              kind="animal_photo"
              label={a.photoUrl ? t.web.animals.changePhoto : t.web.animals.addPhoto}
              onUploaded={async (storageKey) => {
                const { data, error: e } = await api.PUT('/v1/animals/{id}/photo', {
                  params: { path: { id } },
                  body: { storageKey },
                });
                if (data) setAnimal(data);
                return e;
              }}
            />
            {a.photoUrl && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const { data } = await api.DELETE('/v1/animals/{id}/photo', {
                    params: { path: { id } },
                  });
                  if (data) setAnimal(data);
                }}
              >
                {t.web.animals.removePhoto}
              </Button>
            )}
            {!editing && (
              <Button variant="secondary" onClick={startEdit}>
                {t.web.animals.edit}
              </Button>
            )}
          </div>
          {editing && (
            <div className="space-y-3">
              <Field label={t.web.animals.name}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </Field>
              <Field label={t.web.animals.breed}>
                <Input value={breed} onChange={(e) => setBreed(e.target.value)} maxLength={60} />
              </Field>
              <Field label={t.web.animals.sex}>
                <Select value={sex} onChange={(e) => setSex(e.target.value as AnimalSex | '')}>
                  <option value="">{t.web.common.choose}</option>
                  {ANIMAL_SEXES.map((x) => (
                    <option key={x} value={x}>
                      {t.web.animals[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.web.animals.dob}>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </Field>
              <ErrorBox message={error} />
              <div className="flex gap-2">
                <Button onClick={() => void save()}>{t.web.animals.saveChanges}</Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  {t.web.common.cancel}
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">{t.web.animals.historyTitle}</h2>
          {h.visits.length === 0 && <p className="text-muted">{t.web.animals.noVisits}</p>}
          <ul className="divide-y divide-line">
            {h.visits.map((v) => (
              <li key={v.bookingId} className="py-2">
                <Link href={`/farmer/bookings/${v.bookingId}`} className="font-semibold underline">
                  {fmt(t.web.tracking.title, { ref: v.bookingId })}
                </Link>{' '}
                · {new Date(v.createdAt).toLocaleDateString(lang)} ·{' '}
                {t.ussd.problems[v.problemType]} · {t.ussd.statuses[v.status]}
                {v.treatment?.diagnosis && (
                  <p className="text-muted">
                    {t.web.tracking.diagnosis}: {v.treatment.diagnosis}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
