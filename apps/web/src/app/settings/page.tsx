'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usernameProblem } from '@vetlink/shared';
import { PersonAvatar } from '@/components/pictures';
import { PhotoUpload } from '@/components/photo-upload';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, ChoiceGrid, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { WardPicker } from '@/components/ward-picker';
import { errorText } from '@/lib/errors';
import { useLang, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** My profile (§24.1): photo, username, name, farm; then language and log out. */
export default function Profile() {
  const { t, fmt, lang } = useT();
  const { setLang } = useLang();
  const { api, me, reloadMe, logout } = useSession();
  const router = useRouter();
  const p = t.web.profile;
  const isVet = me?.roles.includes('vet') ?? false;
  const isFarmer = me?.roles.includes('farmer') ?? false;

  // Edits are drafts over the saved profile (null = unchanged).
  const [nameDraft, setName] = useState<string | null>(null);
  const [usernameDraft, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [wardId, setWardId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isFarmer) return;
    void api.GET('/v1/farmers/me').then(({ data }) => {
      setWardId(data?.ward?.id ?? null);
      setNotes(data?.farmNotes ?? '');
    });
  }, [api, isFarmer]);

  if (!me) return null;
  const name = nameDraft ?? me.name ?? '';
  const username = usernameDraft ?? me.displayName ?? '';
  const problem = username.trim() ? usernameProblem(username) : null;

  async function save() {
    setError(null);
    setSaved(false);
    const { error: e } = await api.PATCH('/v1/me', {
      body: {
        displayName: username.trim() || null,
        // A vet's name is the verified legal name: only a reviewed application changes it.
        ...(!isVet && name.trim() && { name: name.trim() }),
      },
    });
    if (!e && isFarmer && wardId) {
      const farm = await api.PUT('/v1/farmers/me', {
        body: { wardId, farmNotes: notes.trim() || null },
      });
      if (farm.error) return setError(errorText(lang, farm.error));
    }
    if (e) return setError(errorText(lang, e));
    await reloadMe();
    setName(null);
    setUsername(null);
    setSaved(true);
  }

  const review = me.photo.review;
  return (
    <Shell title={p.title}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-bold">{p.photo}</h2>
          <div className="flex flex-wrap items-center gap-4">
            <PersonAvatar url={me.photo.url} name={me.displayName ?? me.name} size={96} />
            {review?.status === 'pending' && (
              <div className="flex items-center gap-2">
                <PersonAvatar url={review.url} name={me.name} size={64} />
                <Badge tone="warning">{p.photoPending}</Badge>
              </div>
            )}
          </div>
          {review?.status === 'pending' && <Notice>{p.photoPendingHint}</Notice>}
          {review?.status === 'rejected' && (
            <Notice tone="danger">
              {fmt(p.photoRejected, { reason: p.photoReasons[review.reason] })}
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <PhotoUpload
              kind="avatar"
              label={me.photo.url ? p.changePhoto : p.addPhoto}
              onUploaded={async (storageKey) => {
                const { error: e } = await api.PUT('/v1/me/avatar', { body: { storageKey } });
                if (!e) await reloadMe();
                return e;
              }}
            />
            {(isVet ? review?.status === 'pending' : !!me.photo.url) && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const { error: e } = await api.DELETE('/v1/me/avatar');
                  if (e) setError(errorText(lang, e));
                  else await reloadMe();
                }}
              >
                {isVet ? p.withdrawPhoto : p.removePhoto}
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          {isVet ? (
            <Field label={p.verifiedName} hint={p.verifiedNameHint}>
              <Input value={me.name ?? ''} readOnly />
            </Field>
          ) : (
            <Field label={p.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
          )}
          <Field
            label={`${p.username} (${t.web.common.optional})`}
            hint={isVet ? p.vetUsernameHint : p.usernameHint}
          >
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              aria-invalid={!!problem}
            />
          </Field>
          {problem && <p className="text-sm text-emergency">{p.usernameErrors[problem]}</p>}
          <Field label={p.phone} hint={p.phoneHint}>
            <Input value={`+${me.phone}`} readOnly />
          </Field>
          {isFarmer && (
            <>
              <h2 className="pt-2 font-bold">{p.farm}</h2>
              <WardPicker value={wardId} onChange={setWardId} />
              <Field label={t.web.onboarding.farmNotesLabel} hint={t.web.onboarding.farmNotesHint}>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
              </Field>
            </>
          )}
          <ErrorBox message={error} />
          {saved && <Notice tone="success">{t.web.common.saved}</Notice>}
          <Button disabled={!!problem} onClick={() => void save()}>
            {t.web.common.save}
          </Button>
        </Card>

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
              await api.PATCH('/v1/me', { body: { language: l } });
            }}
          />
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
