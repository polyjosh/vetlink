import { router } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../src/components/screen';
import { Button, Choices, Notice } from '../src/components/ui';
import { useLang, useT } from '../src/lib/i18n';
import { api, useSession } from '../src/lib/session';

/** Language (saved to the account so SMS and USSD use it too) and log out. */
export default function Settings() {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const { logout } = useSession();
  const [saved, setSaved] = useState(false);
  return (
    <Screen title={t.web.common.settings}>
      <Choices
        options={[
          { value: 'sw' as const, label: t.web.common.swahili },
          { value: 'en' as const, label: t.web.common.english },
        ]}
        value={lang}
        onChange={async (l) => {
          setLang(l);
          const { error } = await api
            .PATCH('/v1/me', { body: { language: l } })
            .catch(() => ({ error: true }));
          setSaved(!error);
        }}
      />
      {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
      <Button title={t.web.common.back} variant="secondary" onPress={() => router.back()} />
      <Button
        title={t.web.common.logout}
        variant="ghost"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
    </Screen>
  );
}
