'use client';

import { useEffect, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Field, Select } from './ui';

/** County → ward picker (ward is the base location unit, §7). */
export function WardPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number) => void;
}) {
  const { t } = useT();
  const { api } = useSession();
  const [counties, setCounties] = useState<string[]>([]);
  const [county, setCounty] = useState('');
  const [wards, setWards] = useState<Schemas['Ward'][]>([]);
  useEffect(() => {
    void api.GET('/v1/locations/counties').then(({ data }) => {
      setCounties(data ?? []);
      if (data?.length === 1 && data[0]) setCounty(data[0]);
    });
  }, [api]);
  useEffect(() => {
    if (!county) return;
    void api
      .GET('/v1/locations/wards', { params: { query: { county } } })
      .then(({ data }) => setWards(data ?? []));
  }, [api, county]);
  return (
    <div className="space-y-3">
      <Field label={t.web.onboarding.countyLabel}>
        <Select value={county} onChange={(e) => setCounty(e.target.value)}>
          <option value="">{t.web.common.choose}</option>
          {counties.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label={t.web.onboarding.wardLabel}>
        <Select
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={!county}
        >
          <option value="">{t.web.common.choose}</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.ward} ({w.subCounty})
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
