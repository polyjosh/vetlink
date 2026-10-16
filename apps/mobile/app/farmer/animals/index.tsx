import { useState } from 'react';
import { Text, View } from 'react-native';
import { ANIMAL_SEXES, SPECIES, type AnimalSex, type Species } from '@vetlink/shared';
import { space } from '@vetlink/ui-tokens';
import { Screen } from '../../../src/components/screen';
import { Button, Card, Choices, ErrorText, Field, H2, P } from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';

export default function Animals() {
  const { t, err } = useT();
  const q = useApi(['animals'], () => api.GET('/v1/animals'), { cache: 'animals' });
  const [species, setSpecies] = useState<Species>('cattle');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = t.web.animals;
  return (
    <Screen
      title={a.title}
      role="farmer"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <Card>
        {(q.data ?? []).length === 0 && <P muted>{a.empty}</P>}
        {(q.data ?? []).map((x) => (
          <View key={x.id} style={{ flexDirection: 'row', paddingVertical: space.sm }}>
            <Text style={{ flex: 1, fontWeight: '700' }}>{x.nameOrTag ?? '-'}</Text>
            <Text>{t.ussd.species[x.species]}</Text>
          </View>
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
        <ErrorText message={error} />
        <Button
          title={a.add}
          onPress={async () => {
            setError(null);
            try {
              const { error: e } = await api.POST('/v1/animals', {
                body: { species, ...(name && { nameOrTag: name }), ...(sex && { sex }) },
              });
              if (e) return setError(err(e));
              setName('');
              setSex(null);
              await q.refetch();
            } catch {
              setError(t.web.common.offline);
            }
          }}
        />
      </Card>
    </Screen>
  );
}
