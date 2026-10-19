import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ANIMAL_SEXES, type AnimalSex } from '@vetlink/shared';
import { AnimalPicture } from '../../../src/components/pictures';
import { PhotoButtons } from '../../../src/components/photo-buttons';
import { Screen } from '../../../src/components/screen';
import {
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Loading,
  P,
  s,
} from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';

/** One animal: photo (or species picture), details, and its visits. */
export default function AnimalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fmt, err, lang } = useT();
  const q = useApi(['animal', id], () =>
    api.GET('/v1/animals/{id}/history', { params: { path: { id } } }),
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.animals;
  if (!q.data) return <Loading label={t.web.common.loading} />;
  const animal = q.data.animal;

  async function save() {
    setError(null);
    try {
      const { error: e } = await api.PATCH('/v1/animals/{id}', {
        params: { path: { id } },
        body: { nameOrTag: name.trim() || null, breed: breed.trim() || null, sex },
      });
      if (e) return setError(err(e));
      setEditing(false);
      await q.refetch();
    } catch {
      setError(t.web.common.offline);
    }
  }

  return (
    <Screen
      title={animal.nameOrTag ?? t.ussd.species[animal.species]}
      role="farmer"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <Card>
        <View style={s.row}>
          <AnimalPicture url={animal.photoUrl} species={animal.species} size={112} />
          <View>
            <H2>{t.ussd.species[animal.species]}</H2>
            {animal.breed && <P muted>{animal.breed}</P>}
            {animal.sex && <P muted>{a[animal.sex]}</P>}
          </View>
        </View>
        <PhotoButtons
          kind="animal_photo"
          onUploaded={async (storageKey) => {
            const { error: e } = await api.PUT('/v1/animals/{id}/photo', {
              params: { path: { id } },
              body: { storageKey },
            });
            if (!e) await q.refetch();
            return e;
          }}
        />
        {animal.photoUrl && (
          <Button
            title={a.removePhoto}
            variant="ghost"
            onPress={async () => {
              await api
                .DELETE('/v1/animals/{id}/photo', { params: { path: { id } } })
                .catch(() => undefined);
              await q.refetch();
            }}
          />
        )}
        {!editing ? (
          <Button
            title={a.edit}
            variant="secondary"
            onPress={() => {
              setName(animal.nameOrTag ?? '');
              setBreed(animal.breed ?? '');
              setSex(animal.sex);
              setEditing(true);
            }}
          />
        ) : (
          <>
            <Field label={a.name} value={name} onChangeText={setName} maxLength={60} />
            <Field label={a.breed} value={breed} onChangeText={setBreed} maxLength={60} />
            <Choices
              options={ANIMAL_SEXES.map((x) => ({ value: x, label: a[x] }))}
              value={sex}
              onChange={setSex}
            />
            <ErrorText message={error} />
            <Button title={a.saveChanges} onPress={() => void save()} />
            <Button
              title={t.web.common.cancel}
              variant="secondary"
              onPress={() => setEditing(false)}
            />
          </>
        )}
      </Card>
      <Card>
        <H2>{a.historyTitle}</H2>
        {q.data.visits.length === 0 && <P muted>{a.noVisits}</P>}
        {q.data.visits.map((v) => (
          <P key={v.bookingId}>
            {fmt(t.web.tracking.title, { ref: v.bookingId })} ·{' '}
            {new Date(v.createdAt).toLocaleDateString(lang)} · {t.ussd.problems[v.problemType]} ·{' '}
            {t.ussd.statuses[v.status]}
          </P>
        ))}
      </Card>
    </Screen>
  );
}
