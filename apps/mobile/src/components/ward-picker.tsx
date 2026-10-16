import { useState } from 'react';
import { View } from 'react-native';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/query';
import { api } from '../lib/session';
import { Choices, Field, P } from './ui';

/** County, then type a few letters of the ward (60 wards are too many to scroll on a small phone). */
export function WardPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number) => void;
}) {
  const { t } = useT();
  const counties = useApi(['counties'], () => api.GET('/v1/locations/counties'), {
    cache: 'counties',
  });
  const [county, setCounty] = useState<string | null>(null);
  const chosenCounty = county ?? (counties.data?.length === 1 ? (counties.data[0] ?? null) : null);
  const wards = useApi(
    ['wards', chosenCounty],
    () => api.GET('/v1/locations/wards', { params: { query: { county: chosenCounty ?? '' } } }),
    { enabled: !!chosenCounty, cache: `wards:${chosenCounty}` },
  );
  const [q, setQ] = useState('');
  const matches = (wards.data ?? [])
    .filter((w) => w.id === value || w.ward.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <View>
      {(counties.data?.length ?? 0) > 1 && (
        <>
          <P>{t.web.onboarding.countyLabel}</P>
          <Choices
            options={(counties.data ?? []).map((c) => ({ value: c, label: c }))}
            value={chosenCounty}
            onChange={setCounty}
          />
        </>
      )}
      {chosenCounty && (
        <>
          <Field
            label={t.web.onboarding.wardLabel}
            value={q}
            onChangeText={setQ}
            placeholder={t.web.common.choose}
            testID="ward-search"
          />
          <Choices
            options={matches.map((w) => ({ value: w.id, label: `${w.ward} (${w.subCounty})` }))}
            value={value}
            onChange={onChange}
          />
        </>
      )}
    </View>
  );
}
