'use client';

import { useCallback, useState } from 'react';
import { ADMIN_ROLES, type AdminRole } from '@vetlink/shared';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import { Button, Card, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

type Admin = {
  userId: string;
  role: AdminRole;
  name: string | null;
  phone: string | null;
  totpEnabled: boolean;
  revokedAt: string | null;
};

export default function Admins() {
  const { t } = useT();
  const { api, me } = useSession();
  const { run, dialog } = useStepUp();
  const [rows, setRows] = useState<Admin[] | null>(null);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AdminRole>('verifier');
  const [error, setError] = useState<string | null>(null);
  const a = t.web.admin;
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/admins');
    setRows(data ?? []);
  }, [api]);
  useLoad(load);
  return (
    <Shell title={a.admins} role="admin" nav={<AdminNav />}>
      {dialog}
      <div className="space-y-4">
        {!rows ? (
          <Spinner label={t.web.common.loading} />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {rows
                .filter((r) => !r.revokedAt)
                .map((r) => (
                  <li key={r.userId} className="flex min-h-touch flex-wrap items-center gap-2 py-2">
                    <span>{r.name ?? '-'}</span>
                    <span className="text-muted">{r.phone}</span>
                    <span className="flex-1" />
                    <span>{a.adminRoles[r.role]}</span>
                    {r.userId !== me?.id && (
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          setError(
                            await run(() =>
                              api.DELETE('/v1/admin/admins/{userId}', {
                                params: { path: { userId: r.userId } },
                              }),
                            ),
                          );
                          await load();
                        }}
                      >
                        {a.revoke}
                      </Button>
                    )}
                  </li>
                ))}
            </ul>
          </Card>
        )}
        <Card className="space-y-3">
          <h2 className="font-bold">{a.grant}</h2>
          <Field label={a.phone}>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={a.role}>
            <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {ADMIN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {a.adminRoles[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            disabled={phone.length < 9}
            onClick={async () => {
              const e = await run(() => api.POST('/v1/admin/admins', { body: { phone, role } }));
              setError(e);
              if (!e) setPhone('');
              await load();
            }}
          >
            {a.grant}
          </Button>
        </Card>
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
