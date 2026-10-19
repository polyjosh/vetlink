import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ANIMAL_SEXES, SPECIES, type AnimalSex, type Species } from '@vetlink/shared';
import { space } from '@vetlink/ui-tokens';
import { AnimalPicture, EmptyState } from '../../../src/components/pictures';
import { Screen } from '../../../src/components/screen';
import { Button, Card, Choices, ErrorText, Field, H2, P, s } from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { pickPhoto, uploadPhoto, type PhotoSource } from '../../../src/lib/photo';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';

export default function Animals() {
  const { t, err } = useT();
  const q = useApi(['animals'], () => api.GET('/v1/animals'), { cache: 'animals' });
  const [species, setSpecies] = useState<Species>('cattle');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.animals;

  async function choose(source: PhotoSource) {
    setError(null);
    try {
      const picked = await pickPhoto(source, 'animal_photo');
      if (picked) setPhoto(picked);
    } catch {
      setError(t.web.profile.photoFailed);
    }
  }

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const { data: created, error: e } = await api.POST('/v1/animals', {
        body: { species, ...(name && { nameOrTag: name }), ...(sex && { sex }) },
      });
      if (e || !created) return setError(err(e));
      // The photo is optional and goes up after the animal exists (§24.2).
      if (photo) {
        const up = await uploadPhoto('animal_photo', photo);
        const c =
          'storageKey' in up
            ? await api.PUT('/v1/animals/{id}/photo', {
                params: { path: { id: created.id } },
                body: { storageKey: up.storageKey },
              })
            : { error: up.error };
        if (c.error) setError(t.web.profile.photoFailed); // saved; add the photo later
      }
      setName('');
      setSex(null);
      setPhoto(null);
      await q.refetch();
    } catch {
      setError(t.web.common.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={a.title}
      role="farmer"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <Card>
        {(q.data ?? []).length === 0 && <EmptyState kind="noAnimals" text={a.empty} />}
        {(q.data ?? []).map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            onPress={() => router.push(`/farmer/animals/${x.id}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.sm,
            }}
          >
            <AnimalPicture url={x.photoUrl} species={x.species} />
            <Text style={{ flex: 1, fontWeight: '700' }}>{x.nameOrTag ?? '-'}</Text>
            <Text>{t.ussd.species[x.species]}</Text>
          </Pressable>
        ))}
      </Card>
      <Card>
        <H2>{a.add}</H2>
        <Choices
          options={SPECIES.map((x) => ({ value: x, label: t.ussd.species[x] }))}
          value={species}
          onChange={setSpecies}
        />
        <Field label={a.name} value={name} onChangeText={setName} maxLength={60} />
        <Choices
          options={ANIMAL_SEXES.map((x) => ({ value: x, label: a[x] }))}
          value={sex}
          onChange={setSex}
        />
        <P>{`${a.photo} (${t.web.common.optional})`}</P>
        <View style={s.row}>
          <AnimalPicture url={photo?.uri} species={species} size={64} />
          <Button title={t.web.mobile.takePhoto} onPress={() => void choose('camera')} />
          <Button
            title={t.web.mobile.choosePhoto}
            variant="secondary"
            onPress={() => void choose('library')}
          />
          {photo && <Button title={a.removePhoto} variant="ghost" onPress={() => setPhoto(null)} />}
        </View>
        <P muted>{a.photoHint}</P>
        <ErrorText message={error} />
        <Button
          title={busy ? t.web.common.saving : a.add}
          disabled={busy}
          onPress={() => void add()}
        />
      </Card>
    </Screen>
  );
}
