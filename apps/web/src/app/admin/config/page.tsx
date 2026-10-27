'use client';

import { useCallback, useState } from 'react';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import { Button, Card, ErrorBox, Notice, Spinner, TextArea } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** Matching and pricing settings (app_config). Super admin, step-up, audited. */
export default function AdminConfig() {
  const { t } = useT();
  const { api } = useSession();
  const { run, dialog } = useStepUp();
  const [rows, setRows] = useState<{ key: string; value: unknown; isDefault: boolean }[] | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/config');
    setRows(data ?? []);
    setDrafts(
      Object.fromEntries((data ?? []).map((r) => [r.key, JSON.stringify(r.value, null, 2)])),
    );
  }, [api]);
  useLoad(load);
  const a = t.web.admin;
  return (
    <Shell title={a.config} role="admin" nav={<AdminNav />}>
      {dialog}
      <div className="space-y-4">
        <Notice>{a.configHint}</Notice>
        <ErrorBox message={error} />
        {saved && <Notice tone="success">{`${t.web.common.saved}: ${saved}`}</Notice>}
        {!rows ? (
          <Spinner label={t.web.common.loading} />
        ) : (
          rows.map((r) => (
            <Card key={r.key} className="space-y-2">
              <h2 className="font-mono font-bold">{r.key}</h2>
              <TextArea
                className="font-mono text-sm"
                rows={Math.min(12, (drafts[r.key] ?? '').split('\n').length + 1)}
                value={drafts[r.key] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })}
              />
              <Button
                onClick={async () => {
                  setSaved(null);
                  let value: unknown;
                  try {
                    value = JSON.parse(drafts[r.key] ?? '');
                  } catch {
                    return setError(t.web.common.somethingWrong);
                  }
                  const e = await run(() =>
                    api.PUT('/v1/admin/config/{key}', {
                      params: { path: { key: r.key } },
                      body: { value },
                    }),
                  );
                  setError(e);
                  if (!e) {
                    setSaved(r.key);
                    await load();
                  }
                }}
              >
                {t.web.common.save}
              </Button>
            </Card>
          ))
        )}
      </div>
    </Shell>
  );
}
