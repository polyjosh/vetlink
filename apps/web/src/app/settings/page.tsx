'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ChoiceGrid, Notice } from '@/components/ui';
import { useLang, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Language (saved to the account so SMS and USSD use it too) and log out. */
export default function Settings() {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const { api, logout } = useSession();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <Shell title={t.web.common.settings}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-bold">{t.web.common.language}</h2>
          <ChoiceGrid
            options={[
              { value: 'sw', label: t.web.common.swahili },
              { value: 'en', label: t.web.common.english },
            ]}
            value={lang}
            onChange={async (l) => {
              setLang(l);
              const { error } = await api.PATCH('/v1/me', { body: { language: l } });
              setSaved(!error);
            }}
          />
          {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
        </Card>
        <Button
          variant="secondary"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          {t.web.common.logout}
        </Button>
      </div>
    </Shell>
  );
}
