'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ANIMAL_SEXES, SPECIES, type AnimalSex, type Species } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
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
  async function add() {
    const { error: e } = await api.POST('/v1/animals', {
      body: {
        species,
        ...(name && { nameOrTag: name }),
        ...(breed && { breed }),
        ...(sex && { sex }),
      },
    });
    if (e) setError(errorText(lang, e));
    else {
      setName('');
      setBreed('');
      setSex('');
      await load();
    }
  }
  return (
    <Shell title={t.web.animals.title} role="farmer" nav={<FarmerNav />}>
      <div className="space-y-4">
        <Card>
          {rows.length === 0 && <p className="text-muted">{t.web.animals.empty}</p>}
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/farmer/animals/${a.id}`}
                  className="flex min-h-touch items-center justify-between py-2"
                >
                  <span>{a.nameOrTag ?? '-'}</span>
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
          <ErrorBox message={error} />
          <Button onClick={() => void add()}>{t.web.animals.add}</Button>
        </Card>
      </div>
    </Shell>
  );
}
