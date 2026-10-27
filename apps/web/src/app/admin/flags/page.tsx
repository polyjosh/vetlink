'use client';

import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** Vets flagged by complaints or low ratings (§24.7): review, then mark reviewed or suspend. */
export default function Flags() {
  const { t, lang } = useT();
  const { api } = useSession();
  const a = t.web.admin;
  const [rows, setRows] = useState<Schemas['FlaggedVet'][] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/vets/flagged');
    setRows(data ?? []);
  }, [api]);
  usePoll(load, 60_000);

  async function clear(userId: string) {
    setError(null);
    const { error: e } = await api.POST('/v1/admin/vets/{userId}/review-flag/clear', {
      params: { path: { userId } },
      body: { note: notes[userId] ?? '' },
    });
    if (e) setError(errorText(lang, e));
    await load();
  }

  return (
    <Shell title={a.flagsTitle} role="admin" nav={<AdminNav />}>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner label={t.web.common.loading} />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">{a.flagsEmpty}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.vetUserId} className="space-y-2">
              <p className="font-bold">
                {r.name ?? '-'} · {a.flagReasons[r.reason]}
              </p>
              <p className="text-sm text-muted">
                {new Date(r.flaggedAt).toLocaleString(lang)}
                {r.rating !== null && ` · ★ ${r.rating.toFixed(1)}`}
              </p>
              <Field label={a.clearNote}>
                <Input
                  value={notes[r.vetUserId] ?? ''}
                  maxLength={500}
                  onChange={(e) => setNotes({ ...notes, [r.vetUserId]: e.target.value })}
                />
              </Field>
              <Button
                disabled={(notes[r.vetUserId] ?? '').trim().length < 3}
                onClick={() => void clear(r.vetUserId)}
              >
                {a.clearFlag}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
