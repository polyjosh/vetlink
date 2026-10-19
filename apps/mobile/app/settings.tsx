import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { usernameProblem } from '@vetlink/shared';
import { PersonAvatar } from '../src/components/pictures';
import { PhotoButtons } from '../src/components/photo-buttons';
import { Screen } from '../src/components/screen';
import {
  Badge,
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Notice,
  s,
} from '../src/components/ui';
import { WardPicker } from '../src/components/ward-picker';
import { useLang, useT } from '../src/lib/i18n';
import { api, useSession } from '../src/lib/session';

/** My profile (§24.1): photo, username, name, farm; then language and log out. */
export default function Profile() {
  const { t, fmt, err } = useT();
  const { lang, setLang } = useLang();
  const { me, reloadMe, logout } = useSession();
  const p = t.web.profile;
  const isVet = me?.roles.includes('vet') ?? false;
  const isFarmer = me?.roles.includes('farmer') ?? false;

  // Edits are drafts over the saved profile (null = unchanged).
  const [nameDraft, setName] = useState<string | null>(null);
  const [usernameDraft, setUsername] = useState<string | null>(null);
  const [wardId, setWardId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isFarmer) return;
    void api
      .GET('/v1/farmers/me')
      .then(({ data }) => {
        setWardId(data?.ward?.id ?? null);
        setNotes(data?.farmNotes ?? '');
      })
      .catch(() => undefined);
  }, [isFarmer]);

  if (!me) return null;
  const name = nameDraft ?? me.name ?? '';
  const username = usernameDraft ?? me.displayName ?? '';
  const problem = username.trim() ? usernameProblem(username) : null;
  const review = me.photo.review;

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const { error: e } = await api.PATCH('/v1/me', {
        body: {
          displayName: username.trim() || null,
          // A vet's name is the verified legal name: only a reviewed application changes it.
          ...(!isVet && name.trim() && { name: name.trim() }),
        },
      });
      if (e) return setError(err(e));
      if (isFarmer && wardId) {
        const farm = await api.PUT('/v1/farmers/me', {
          body: { wardId, farmNotes: notes.trim() || null },
        });
        if (farm.error) return setError(err(farm.error));
      }
      await reloadMe();
      setName(null);
      setUsername(null);
      setSaved(true);
    } catch {
      setError(t.web.common.offline);
    }
  }

  return (
    <Screen title={p.title}>
      <Card>
        <H2>{p.photo}</H2>
        <View style={s.row}>
          <PersonAvatar url={me.photo.url} name={me.displayName ?? me.name} size={96} />
          {review?.status === 'pending' && (
            <View style={s.row}>
              <PersonAvatar url={review.url} name={me.name} size={64} />
              <Badge tone="warning">{p.photoPending}</Badge>
            </View>
          )}
        </View>
        {review?.status === 'pending' && <Notice>{p.photoPendingHint}</Notice>}
        {review?.status === 'rejected' && (
          <Notice tone="warning">
            {fmt(p.photoRejected, { reason: p.photoReasons[review.reason] })}
          </Notice>
        )}
        <PhotoButtons
          kind="avatar"
          onUploaded={async (storageKey) => {
            const { error: e } = await api.PUT('/v1/me/avatar', { body: { storageKey } });
            if (!e) await reloadMe();
            return e;
          }}
        />
        {(isVet ? review?.status === 'pending' : !!me.photo.url) && (
          <Button
            title={isVet ? p.withdrawPhoto : p.removePhoto}
            variant="ghost"
            onPress={async () => {
              const { error: e } = await api.DELETE('/v1/me/avatar').catch(() => ({
                error: { code: 'internal_error' },
              }));
              if (e) setError(err(e));
              else await reloadMe();
            }}
          />
        )}
      </Card>

      <Card>
        {isVet ? (
          <Field
            label={p.verifiedName}
            hint={p.verifiedNameHint}
            value={me.name ?? ''}
            editable={false}
          />
        ) : (
          <Field label={p.name} value={name} onChangeText={setName} maxLength={80} />
        )}
        <Field
          label={`${p.username} (${t.web.common.optional})`}
          hint={problem ? p.usernameErrors[problem] : isVet ? p.vetUsernameHint : p.usernameHint}
          value={username}
          onChangeText={setUsername}
          maxLength={30}
        />
        <Field label={p.phone} hint={p.phoneHint} value={`+${me.phone}`} editable={false} />
        {isFarmer && (
          <>
            <H2>{p.farm}</H2>
            <WardPicker value={wardId} onChange={setWardId} />
            <Field
              label={t.web.onboarding.farmNotesLabel}
              hint={t.web.onboarding.farmNotesHint}
              value={notes}
              onChangeText={setNotes}
              maxLength={300}
            />
          </>
        )}
        <ErrorText message={error} />
        {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
        <Button title={t.web.common.save} disabled={!!problem} onPress={() => void save()} />
      </Card>

      <Card>
        <H2>{t.web.common.language}</H2>
        <Choices
          options={[
            { value: 'sw' as const, label: t.web.common.swahili },
            { value: 'en' as const, label: t.web.common.english },
          ]}
          value={lang}
          onChange={async (l) => {
            setLang(l);
            await api.PATCH('/v1/me', { body: { language: l } }).catch(() => undefined);
          }}
        />
      </Card>
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
