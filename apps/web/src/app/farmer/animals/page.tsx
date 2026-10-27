'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ANIMAL_SEXES, SPECIES, type AnimalSex, type Species } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { AnimalPicture, EmptyState } from '@/components/pictures';
import { preparePhoto } from '@/lib/photo';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

export default function Animals() {
  const { t, lang } = useT();
  const { api } = useSession();
  const [rows, setRows] = useState<Schemas['Animal'][]>([]);
  const [species, setSpecies] = useState<Species>('cattle');
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [sex, setSex] = useState<AnimalSex | ''>('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/animals');
    setRows(data ?? []);
  }, [api]);
  useLoad(load);
  const [photo, setPhoto] = useState<File | null>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const [busy, setBusy] = useState(false);
  async function add() {
    setError(null);
    setBusy(true);
    try {
      const { data: created, error: e } = await api.POST('/v1/animals', {
        body: {
          species,
          ...(name && { nameOrTag: name }),
          ...(breed && { breed }),
          ...(sex && { sex }),
        },
      });
      if (e || !created) return setError(errorText(lang, e));
      // The photo is optional and goes up after the animal exists (§24.2).
      if (photo) {
        try {
          const blob = await preparePhoto(photo, 'animal_photo');
          const p = await api.POST('/v1/uploads/presign', {
            body: {
              purpose: 'photo',
              photoKind: 'animal_photo',
              contentType: 'image/jpeg',
              size: blob.size,
            },
          });
          if (!p.data) throw p.error;
          const put = await fetch(p.data.uploadUrl, {
            method: 'PUT',
            headers: p.data.headers,
            body: blob,
          });
          if (!put.ok) throw new Error('upload');
          const c = await api.PUT('/v1/animals/{id}/photo', {
            params: { path: { id: created.id } },
            body: { storageKey: p.data.storageKey },
          });
          if (c.error) throw c.error;
        } catch {
          setError(t.web.profile.photoFailed); // the animal is saved; add the photo later
        }
      }
      setName('');
      setBreed('');
      setSex('');
      setPhoto(null);
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title={t.web.animals.title} role="farmer" nav={<FarmerNav />}>
      <div className="space-y-4">
        <Card>
          {rows.length === 0 && <EmptyState kind="noAnimals" text={t.web.animals.empty} />}
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/farmer/animals/${a.id}`}
                  className="flex min-h-touch items-center gap-3 py-2"
                >
                  <AnimalPicture url={a.photoUrl} species={a.species} />
                  <span className="flex-1">{a.nameOrTag ?? '-'}</span>
                  <span className="text-muted">{t.ussd.species[a.species]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t.web.animals.add}</h2>
          <Field label={t.web.animals.species}>
            <Select value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
              {SPECIES.map((s) => (
                <option key={s} value={s}>
                  {t.ussd.species[s]}
                </option>
              ))}
            </Select>
          </Field>
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
          <Field
            label={`${t.web.animals.photo} (${t.web.common.optional})`}
            hint={t.web.animals.photoHint}
          >
            <div className="flex items-center gap-3">
              <AnimalPicture url={preview} species={species} size={64} />
              <label className="inline-flex min-h-touch cursor-pointer items-center rounded-control border border-line px-4 font-semibold">
                {photo ? t.web.animals.changePhoto : t.web.animals.addPhoto}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
              {photo && (
                <Button variant="ghost" onClick={() => setPhoto(null)}>
                  {t.web.animals.removePhoto}
                </Button>
              )}
            </div>
          </Field>
          <ErrorBox message={error} />
          <Button disabled={busy} onClick={() => void add()}>
            {busy ? t.web.common.saving : t.web.animals.add}
          </Button>
        </Card>
      </div>
    </Shell>
  );
}
